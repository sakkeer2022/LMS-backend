# Handoff: faculty onboarding, review, tutor pricing and price consent (LMS-39, LMS-40)

For a developer (or their AI agent) picking up this work. It covers the three repos changed on branch `feature/LMS-78-faculty-module`: `amentorz-backend`, `amentorz-admin`, `amentorz-faculty`. `amentorz-student` was not touched.

Read the repo rules first: `amentorz-backend/.agents/AGENTS.md` and `CLAUDE.md`, and `AGENTS.md` in each frontend. The rules that matter most here: no tenancy (no tenant id in URLs, query keys or claims); contract first (`docs/build-contract-draft.py` → `docs/openapi.yaml`); the UI design is final, so anything that would change it goes in `docs/PENDING_DECISIONS.md`.

## 1. The flow

```
Admin                         Backend                                   Tutor (faculty app :3003)
─────                         ───────                                   ─────────────────────────
Faculty › Invite tutor ──▶ POST /admin/faculty/invitations ──email──▶ ${FACULTY_APP_URL}/onboarding?token=…
                                                                         43b credentials
                           POST /faculty/onboarding/session  ◀────────   (checks the token, returns the email)
                           GET  /faculty/onboarding/catalogue ◀───────   43c column picker → subject cards
                           POST /faculty/onboarding/applications ◀────   43d documents (one multipart request)
                             · consumes the invitation                   43e submitted (AMZ-T-<n>)
                             · creates user (faculty role, ACTIVE,
                               email verified), profile, one
                               faculty_assignment per card, 3 docs
Faculty list shows "Pending"
Drawer 27b ───────────────▶ GET  /admin/faculty/{id}
  preview / download ─────▶ GET  /admin/faculty/{id}/documents/{docId}/file
  Mark as verified ───────▶ PUT  …/documents/{docId}/verification
  Verify & publish / Reject▶ PUT /admin/faculty/{id}/review               (email: approved / rejected + reason)
Pricing › Awaiting tutor price
                           GET  /admin/prices/awaiting
  Set price ──────────────▶ POST /admin/prices {curriculumId, facultyId,…}
                             · listener → faculty: once approved AND
                               every card priced → access_ready_at,
                               "account ready" email (once)              Login: POST /auth/faculty/login
                                                                           before ready → 403 FACULTY_PENDING_REVIEW
                                                                                          / FACULTY_PENDING_PRICING
                                                                           ready → requiresTermsAcceptance=true
                           GET  /faculty/me/price-consent  ◀──────────   /consent: prices per card
                           POST /faculty/me/price-consent  ◀──────────   accept → /home
                             · reject: recorded, admin emailed,           decline → stays on /consent
                               tutor stays on /consent; any re-price
                               changes the snapshot hash → consent asked again
```

The sign-in gate: a tutor can sign in only when **approved, not suspended, and every active subject card has an active tutor price** (decided with the client on 2026-11-04). Price consent is then asked on every change of the priced set.

## 2. Database (migration `20261104090000_faculty_onboarding`)

| Change | Detail |
|---|---|
| `FacultyDocumentType` | adds `PAN_CARD` |
| `faculty_profiles` new columns | `city`, `highest_qualification`, `studied_at`, `teaching_experience` (CHECK `0-1`,`1-3`,`3-5`,`5-10`,`10+`), `offers_offline_classes`, `application_reference` (unique, `AMZ-T-<n>`), `submitted_at`, `declaration_accepted_at`, `invitation_id` (unique FK → `faculty_invitations`, ON DELETE SET NULL), `access_ready_at` |
| Sequence | `faculty_application_reference_seq` starts at 1001. Hand-written in the migration, not in `schema.prisma` |
| New table `faculty_price_consents` | `faculty_id` (FK, cascade), `decision` (`ACCEPTED`/`REJECTED`), `snapshot_hash` (sha-256 hex CHECK), `price_snapshot` JSONB, `ip_address`, `user_agent`, `decided_at`. Append-only; the latest row counts only while its hash matches the current prices |

The full column list is in `docs/database/schema-data-dictionary.md` (§4.1, §4.8).

## 3. Backend

### New endpoints (all in `docs/openapi.yaml`)

| Method and path | Guard | Purpose |
|---|---|---|
| `POST /faculty/onboarding/session` | public, per-IP limit | Check an invitation token. Any unusable link returns 422 `INVITATION_INVALID` |
| `GET /faculty/onboarding/catalogue` | public, per-IP limit | Offering tree for the column picker |
| `POST /faculty/onboarding/applications` | public, per-IP limit | Multipart: text fields plus `photoId`, `degreeCertificate`, `panCard` |
| `GET /faculty/me/price-consent` | faculty `faculty.read_self` | Priced cards, snapshot hash, consent status |
| `POST /faculty/me/price-consent` | faculty `faculty.update_self` | `{decision: accept\|reject, snapshotHash}`; 409 `PRICES_CHANGED` |
| `GET /admin/faculty/{id}` | `faculty.read` | Drawer 27b detail |
| `GET /admin/faculty/{id}/documents/{docId}/file` | `faculty.documents` | File as an attachment (CSP sandbox, nosniff, no-store); audited |
| `PUT /admin/faculty/{id}/documents/{docId}/verification` | `faculty.approve` | `{isVerified}` |
| `PUT /admin/faculty/{id}/review` | `faculty.approve` | `{decision, reason?, publish, expectedRevision}`; 409 `INVALID_TRANSITION` / `STALE_REVISION` |
| `GET /admin/prices/awaiting` | `pricing.read` | Approved tutors' cards with no active tutor price |
| `GET /admin/category-tree/picker` | `catalogue.read` | Same tree as the onboarding catalogue, for admin pickers |

`GET /admin/faculty` rows gain `pricing` (`none`, `awaiting_price`, `awaiting_consent`, `accepted`, `declined`), and `documents.required` is now 3.

### Where the code is

- `src/modules/faculty/`: `faculty.onboarding*.ts` (public flow), `faculty.documents.ts` (allowed types, magic bytes, keys), `faculty.review*.ts` (drawer and decisions), `faculty.access.ts` (sign-in gate, pricing state, snapshot hash, `onTutorPricesChanged`), `faculty.consent.ts`, `faculty.emails.ts`.
- `src/modules/pricing/pricing.events.ts`: `registerTutorPriceListener` / `notifyTutorPricesChanged`, called after create, update and bulk. Faculty registers its listener in its `index.ts`, so there is no circular import.
- `src/modules/pricing/pricing.awaiting.ts`, and `src/modules/category-tree/category-tree.picker.ts` (`getOfferingTree`, `describeOfferings`).
- `src/infrastructure/storage/`: since the merge of `development` (2026-11-06) faculty documents use the shared `FileStorage` (`getStorage`, `getTestStorage` in tests), the same store as consents and policies.
- `src/modules/auth/portal-login.service.ts`: the faculty portal calls `assertFacultyCanSignIn` after the email check. `requiresTermsAcceptance` in the login response now means "price consent pending".
- `src/core/security/rbac.ts`: new permissions `faculty.approve`, `faculty.documents` (admin) and `faculty.read_self`, `faculty.update_self` (the faculty role's only permissions).

### Documents

The accepted types are PDF, JPG, PNG, DOC, DOCX, PPT and PPTX, checked by magic bytes (DOC/PPT share the CFB signature, so the extension decides). The size limit is `config.upload.maxBytes`. Files are stored under `faculty-documents/<uuid>` with `scan_status = PENDING`. Only PDF and images are previewable.

### Configuration (`.env.example`)

| Variable | Default | Note |
|---|---|---|
| `FACULTY_APP_URL` | `http://localhost:3003` | Invitation and login links; https in production |
| `APP_BASE_URL` | `http://localhost:3001` | Now means the **admin** app (the "price declined" email links to `/admin/pricing`) |
| `STORAGE_DRIVER` | `local` (`memory` under test) | `memory` is refused in production |
| `STORAGE_LOCAL_DIR` | `.data/storage` | Outside any web root, and backed up; `.data/` is git-ignored (older checkouts used `storage/private`) |
| `STORAGE_S3_BUCKET` | — | Required when `STORAGE_DRIVER=s3` |
| `FACULTY_ONBOARDING_RATE_LIMIT_WINDOW_MS` / `_MAX` | 900000 / 20 | Per IP, public onboarding routes |

## 4. Admin app (`amentorz-admin`)

The development branch had rebuilt the UI on shadcn/ui, and the feature branch's screens still used the deleted `components/ui` primitives, so it did not compile. Everything is now ported to shadcn:

- **New shared pieces**: `src/components/shadcn/{switch,textarea,native-select}.tsx`; `src/components/forms/field.tsx` (`Field`, `TextField`, `SelectField`, `TextareaField`, `CheckField`, `FormError`); `src/components/forms/confirm-dialog.tsx`; `src/components/layout/page-skeleton.tsx`.
- **Routes without a tenant**: `/admin/faculty`, `/admin/pricing`, `/admin/categories`. The `[tenantId]` routes, the `faculty` fixture branch in `[section]`, and the tenant argument in every hook and query key are removed.
- **Faculty** (`src/features/faculty`): tabs, queue table with a pricing badge, the invite dialog, and `faculty-review-drawer.tsx` (27b), opened by `?tutor=<id>`. Document preview uses an authenticated fetch into a blob URL whose type is pinned to PDF or image; anything else downloads.
- **Pricing** (`src/features/pricing`): `awaiting-prices.tsx` ("Awaiting tutor price", Set price pre-filled with the default price). The rule drawer supports a tutor preset. The offering picker is now category path → subject · board · level, from `/admin/category-tree/picker` (`src/lib/api/offering-tree.ts`).
- **Categories** (`src/features/category-tree`): same logic, shadcn presentation. The dnd-kit dependencies were dropped by the merge-conflict fix and are restored, pinned (`@dnd-kit/core 6.3.1`, `sortable 10.0.0`, `utilities 3.2.2`).
- **Deleted**: the frozen typed catalogue (`features/catalogue`, `lib/api/catalogue*.ts`), the learner discovery preview (`features/discovery`, `lib/api/learner-catalogue.ts`), `components/ui/*`, `features/dashboard/faculty-directory.tsx`, and their tests.

## 5. Faculty app (`amentorz-faculty`)

- `/onboarding` (`src/features/onboarding`): a wizard (credentials → subjects column picker → documents → submitted). Server field errors return the tutor to the step that owns the field.
- `/consent` and `/home` (`src/features/portal`, route group `(portal)`). After login the app goes to `/consent` when `requiresTermsAcceptance` is true. `/home` redirects to `/consent` until the prices are accepted.
- `src/components/ui/fields.tsx`: `TextField`, `SelectField`, `CheckboxField`, `FileDropField`.
- `ApiError` gains `code`, matching the admin app.
- `.env.example` gains `NEXT_PUBLIC_SITE_URL` (the onboarding "back to home" link).

## 6. After pulling

```bash
# amentorz-backend
npm install
npx prisma migrate deploy        # applies 20261104090000_faculty_onboarding
npx prisma generate
npx prisma db seed               # re-seeds RBAC: adds faculty.approve, faculty.documents, *_self
# add FACULTY_APP_URL and STORAGE_* to .env (see .env.example)

# amentorz-admin
npm install                      # restores @dnd-kit/* in package-lock.json

# amentorz-faculty
npm install
```

Existing admin roles get the new permissions only after `db seed` (it upserts the system roles).

## 7. Verification

- Backend: `npx vitest run` → 62 files, 790 tests passed (plus 2 new picker tests); contract structure check passes (112 paths, 128 operations).
- Admin: `npm run typecheck`, `npx vitest run` (12 files, 148 tests) and `npm run build` pass.
- Faculty: `npm run typecheck`, `node scripts/check-ui.cjs`, `npx vitest run` and `npm run build` pass.
- End to end, with Playwright against all three apps and a seeded database: invite (Copy link) → onboarding → login refused (`FACULTY_PENDING_REVIEW`) → drawer preview, verify, Verify & publish → login refused (`FACULTY_PENDING_PRICING`) → Pricing › Set price → login → `/consent` → Accept → `/home`; the admin list then shows "Prices accepted".

## 8. Open decisions (`docs/PENDING_DECISIONS.md`)

- F1 and F2: resolved (the onboarding route is in the faculty app; 3 required documents).
- F4: no malware scanner yet; unscanned files are served to admins with protective headers.
- F5: the consent screen design is not final.
- F6: "Expected session rate" and "Languages" are not collected.
- F7: library moderation should reuse the column picker (deferred).
- F8: the onboarding brand-panel numbers are placeholders.
- F9: the sign-in gate lives in LMS-100 code (portal login); its owner should review it.

## 9. Impact on other tickets

- **LMS-38 / LMS-100 (identity)**: the faculty portal login now calls `assertFacultyCanSignIn` and can return 403 with the four `FACULTY_*` codes. `requiresTermsAcceptance` is driven by price consent. Faculty users are created by onboarding (ACTIVE, email verified by the invite link), never through self-registration. The faculty role holds only `faculty.read_self` and `faculty.update_self`.
- **LMS-41 (platform foundation)**: new configuration (above); private object storage needs a backup plan, an S3 bucket for production, and must sit outside the web root. Uploads currently have no malware scanning (F4). The OpenAPI contract and `sprint-1-endpoints.md` are regenerated.
- **LMS-87 (faculty terms)**: the onboarding declaration is stored as `declaration_accepted_at`. The `faculty_terms` / `faculty_terms_acceptances` tables are not used yet.
- **Not done**: resend and revoke invitations (LMS-80), profile editing (LMS-82), suspend (LMS-88), library moderation (LMS-61/62).
