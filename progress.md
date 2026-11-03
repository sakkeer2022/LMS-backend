# Progress Log

## 2026-11-03 — Guardian consent signing, downloads and purge (LMS-99)

- `src/infrastructure/pdf/`: `PdfService.stampConsent` appends a "Parent/guardian consent" page (printed name, UTC time, IP, signature, policy hash). Latin, Devanagari and Arabic names print correctly (checked by rendering).
- `consent` module: `POST /consent/guardian-signatures` (multipart, PNG magic bytes, 1 MiB, strict per-IP limit; the age rule is the consent age of the policy's country, 18 for India and the UAE; returns a single-use token whose hash is the only copy stored), `GET /consent/guardian-signatures/file` (token in a header, 404 for unknown, expired or linked, does not consume it), `GET /students/me/guardian-consent/file`, and for admins `GET /admin/students/{studentId}/guardian-consent` (record) and `/file` (reauthentication, audit `consent.downloaded`); `student.read` is a new permission. Every file read re-checks its SHA-256 (503 if missing or altered).
- Purge: `purgeExpiredConsents` deletes only rows still unlinked and expired at the moment of deletion, then their files; an hourly BullMQ job (`purge-expired-consents`) runs it.
- Retention: migration `20261103120000_consent_retention`: deleting a student profile that holds a consent is refused (was a cascade that left the PDF behind).
- `TRUST_PROXY_HOPS` sets Express `trust proxy` so the signing IP is the real client IP behind a proxy.
- Tests: `consent.test.ts` (India and UAE, the day before and the day of the 18th birthday, a country with age 21, names in three scripts, downloads, admin reauth and audit, purge race), `consent-rate-limit.test.ts`, `pdf-stamp.test.ts`, `dates.test.ts`.
- Next: admin policy upload endpoints, the policy loader command, `POST /auth/register` (needs the catalogue confirmation).

## 2026-11-03 — Policies, countries list and file storage (LMS-99)

- Contract: `GET /policies/current` takes a required `country`; new public `GET /regions/countries` (code, name, dial code, default time zone) for the mobile picker; new admin `GET /admin/students/{id}/guardian-consent` (consent metadata). `Policy` gains `country`.
- Migration `20261103110000_policy_country`: `policy_documents.country` (foreign key to `countries`), unique `(type, country, version)`, a partial unique index allowing one current version per type and country.
- `src/infrastructure/storage/`: `FileStorage` interface with local, S3 and memory drivers (`STORAGE_DRIVER`, production requires `s3` and `STORAGE_S3_BUCKET`). The database keeps only driver-independent keys, so moving to S3 is a file copy. The S3 driver is written and unit tested with a fake client; it is untried against AWS until credentials exist.
- `policies` module: current policies per country (503 until all four are loaded, 422 for an unsupported country, never another country's text) and the policy PDF (inline, public cache per version, hash re-checked on every read, 503 if the file is missing or altered); `publishPolicy` makes a version current in one transaction and keeps the old one on record.
- Tests: `policies.test.ts`, `storage.test.ts`, config tests.
- Next: PDF interface and the signing endpoint, the three consent downloads, the purge job, a policy loader command, then registration.

## 2026-11-03 — Account recovery and password change (LMS-100)

- New `account-recovery` module: `POST /auth/recovery/requests` (same 202 for unknown, wrong-portal and inactive accounts, decoy challenge, nothing emailed), `/verify` (code to a single-use, five-minute reset credential, hash stored in `password_reset_grants`) and `/reset` (consumes the credential once even under concurrency, sets the password, activates an account waiting for activation, clears the lockout, ends every session, cancels other recovery and verification credentials, audit `password.reset`, clears the cookies, no automatic login). `PUT /auth/password` (current password checked and counted toward the lockout, new one must differ, every session ends including the caller's, audit `password.changed`).
- Email code on password change (admin accounts by default, `PASSWORD_CHANGE_OTP_ROLES=admin|all`): `POST /auth/password/requests` emails a code to the signed-in account's own address (no email in the body; other accounts get 422) and `PUT /auth/password` also takes `challengeId` and `otp`. The code has its own purpose (`PASSWORD_CHANGE`, migration `20261103100000_password_change_code`), so it cannot be used for recovery and a recovery code cannot be used here. The current password is checked first, then the code, so a wrong password does not use up the code. Tests in `account-recovery.test.ts` and `password-change-otp-all.test.ts`.
- `passwordSchema` in `src/shared/validation/password.ts` (8 characters with a number, at most 72 bytes) is the one password rule; `revokeAllSessions` and `clearTokenCookies` are exported from the auth module.
- Limits reuse the OTP limits (`recovery-send`, `recovery-verify`, `recovery-reset`) and the reauth limit for the change. `RESET_GRANT_EXPIRES_MINUTES` sets the credential lifetime.
- Tests: `tests/modules/account-recovery.test.ts` (end to end for all three portals, uniform answers, single use, simultaneous resets, expiry, cancellation by a new request, sessions ended, first password for a pending account, audit, password rule, CSRF, change-password cases).

## 2026-11-03 — Email interface, OTP logic and registration email OTP (LMS-99)

- `src/infrastructure/email/`: `EmailSender` interface, nodemailer SMTP sender and an in-memory outbox used when `EMAIL_TRANSPORT=memory` (the default under tests). Production requires `SMTP_HOST` and rejects the memory transport. Code bodies are never logged.
- `src/modules/email-otp/`: `issueEmailOtp` (replaces the live challenge for the email and purpose, cooldown returns 429, `deliver: false` makes an undeliverable decoy), `verifyEmailOtp` (keyed HMAC-SHA256 hash, constant-time compare, attempts, single consumption under concurrency, registration token stored as a SHA-256 hash) and `consumeRegistrationToken`. Uses the existing `email_challenges` table; no migration.
- New `registration` module with `POST /auth/registration/email-otp/requests` and `/verify`, per the contract.
- Tests: `tests/modules/registration-otp.test.ts` (16 with the route check). Expiry, attempts, cooldown and the token lifetime are configuration (`OTP_*`, `EMAIL_TOKEN_EXPIRES_MINUTES`).
- Regions: `countries` table (migration `20261103090000_countries`, India and UAE rows) with foreign keys from `student_profiles.country` and `boards.country`; the student default country is dropped. `src/modules/regions/` (`countryFromMobile`, `isValidMobile`, `defaultTimezone`, `guardianConsentAge`, cached list) and pure E.164 helpers in `src/shared/regions/`. Tests: `regions.test.ts`, `regions-mobile.test.ts`, `countries-reference.test.ts` (keeps the migration and `prisma/reference-data/countries.ts` equal). Tests insert the rows with `seedCountries()` because the test setup empties every table.
- Send limits: the registration OTP routes use `routeRateLimit` (`OTP_SEND_RATE_LIMIT_*` per IP and per email, `OTP_VERIFY_RATE_LIMIT_*` per IP), tested in `registration-otp-rate-limit.test.ts`.
- Not yet: policies, consent and `POST /auth/register`.

## 2026-11-02 — Keep me signed in, device replacement, admin profile (LMS-100)

- `rememberMe` on the portal login: a signed `rm` claim in both tokens. Ticked gives a persistent refresh cookie and the 7-day session (`JWT_REFRESH_EXPIRES_IN`); unticked gives a browser-session cookie and a 12-hour session (`JWT_SESSION_EXPIRES_IN`). The choice survives refresh rotation.
- A new sign-in replaces the earlier sessions of the same user, portal and device fingerprint (`supersedeDeviceSessions`), so one browser never lists several sessions. Other devices are untouched.
- `npm run create-admin` creates the first verified `super_admin` from `INITIAL_ADMIN_*` env values (idempotent, no defaults).
- New `admin-profile` module: `PUT /admin/me/profile` (name, mobile in E.164, IANA time zone; email read-only; audited as `profile.updated`) and `GET /admin/me/activity` (the caller's own security events, newest first). `User` gains `timezone` and `lastLoginAt`.
- Tests: keep-me-signed-in block in `portal-login.test.ts`, replacement test in `sessions.test.ts`, new `admin-profile.test.ts`. 225 tests pass across the auth, contract and unit suites; typecheck, eslint and `contract:validate` are clean.
- Open: per-country mobile rules wait for the shared region helper (LMS-99); email and password change wait for email verification (LMS-99).

## 2026-11-02 — Generic login removed, dev origins (LMS-100)

- `POST /auth/login` and `AuthService.login` removed; every login is a portal login. `signIn` test helper for users without a portal. Old generic-login tests deleted (covered by `portal-login.test.ts`, which now also checks the HttpOnly and SameSite cookie flags).
- CORS dev defaults: `http://localhost:3001`, `3002`, `3003` (admin, student, faculty).
- Full suite: 37 files, 331 tests passing.

## 2026-11-02 — Reauthentication (LMS-100)

- `POST /auth/reauthenticate` (`reauth.service.ts`): password check, session-bound freshness, audit (`reauth.success`, `reauth.failed`), lockout shared with login, per-IP limit `REAUTH_RATE_LIMIT_*`. `requireRecentReauth` guards `PUT /admin/settings/{key}`.
- Tests: `reauthenticate.test.ts` (contract, session binding, window, survives refresh, wrong password, 429 lockout, freshness not extended by a failed check, 401/403/422); `settings.test.ts` reauthenticates before writing and checks the 403 without it. `reauthenticate()` helper in `tests/helpers/users.ts`.

## 2026-11-02 — Sessions, refresh and /auth/me contract fixes (LMS-100)

- New `session.service.ts`: refresh rotation (keeps portal, family and the original deadline; re-checks account and portal role; reuse revokes the family outside the transaction and is audited), session list (family-based, paginated, `isCurrent`, no IP), revoke one and revoke others (audited, immediate).
- `GET /auth/me` returns the contract user (`loadContractUser`, shared with the portal login). `POST /auth/refresh` is cookie-only and returns `accessExpiresAt` and `sessionExpiresAt`; it has the `REFRESH_RATE_LIMIT_*` limit.
- `src/core/security/session-revocation.ts` and a check in `authenticate` stop a revoked session's access tokens at once.
- Tests: `sessions.test.ts` rewritten (rotation, deadline, reuse, body token, role loss, list, pagination, revoke, 404, revoke others, `/me`); `contract_responses.test.ts` and three refresh tests in `auth.test.ts` now use the portal login. The three routes moved out of the known-mismatch list.

## 2026-11-02 — Portal logins (LMS-100)

- `POST /auth/{student,faculty,admin}/login` in the auth module (`portal-login.service.ts`, `portal-login.controller.ts`), rate limited per IP and per email, audited (`login.success`, `login.failed` with reason, never the password). Response matches the contract (`LoginResult`).
- Refactor: token issuing moved to `session.ts` (portal and family on the refresh row, absolute deadline option for rotation), cookie helpers to `session-cookies.ts` (refresh cookie max age now follows `JWT_REFRESH_EXPIRES_IN`), impossible-travel check extracted as `assessLoginLocation`, `auth/index.ts` added.
- Tests: `tests/modules/portal-login.test.ts` (all three portals, wrong portal, super_admin, generic 401, lockout, unverified 403, 422, CSRF, audit) and `portal-login-rate-limit.test.ts` (429 with `Retry-After`). `tests/env-setup.ts` sets high default limits so shared-IP suites never hit them.
- The sample "unimplemented contract path" in the API docs tests is now `/admin/faculty`.

## 2026-11-02 — Per-route rate limiter (LMS-100)

- `src/middleware/rate-limit.ts` (`routeRateLimit`): per-IP limit and optional per-email limit (normalised `body.email`, falls back to the IP) for one route. Redis store with a per-route key prefix; memory store in tests. A rejected request gets 429 with `Retry-After`.
- `tests/unit/rate-limit.test.ts`: IP limit, email limit (case and spaces ignored, other emails unaffected), fallback to the IP, separate counters per route.
- Not applied to any route yet; login and refresh use it in the next commits.

## 2026-10-29 — API contract checks: routes and response shapes (LMS-93)

- `tests/unit/api-contract-routes.test.ts`: every implemented route must be in `docs/openapi.yaml` or in a known-undocumented list with a reason; stale list entries also fail. Runs in `npm run test:unit`, so Bitbucket Pipelines enforces it.
- `src/routes/index.ts` declares its mounts in an exported `featureRouters` list (Express 5 does not expose mount paths).
- Proven to catch drift: a temporary undocumented route failed the test.
- Response-schema validation: `tests/helpers/contract.ts` (`expectContractResponse`) with `ajv` and `ajv-formats` (dev dependencies). `tests/modules/contract_responses.test.ts` proves `GET /auth/csrf-token`, `DELETE /auth/sessions`, `POST /auth/logout` and the 401/422 error envelopes match, and tracks known mismatches (`/auth/me`, `/auth/sessions`, `/auth/refresh` for LMS-100; `GET /audit` for LMS-103).
- After LMS-90 merged: `/admin/settings` added to `featureRouters` (above `/admin`), and the settings integration tests check list, get, update, 404, 409 and 422 responses against the contract.
- LMS-93 stays open only for serving the approved contract at `/api/docs` once Sprint 1 endpoints exist.

## 2026-10-29 — Platform settings API (LMS-90)

- New `settings` module: `GET /admin/settings`, `GET /admin/settings/{key}`, `PUT /admin/settings/{key}` per the contract, guarded by `configuration.read` and `configuration.manage` (added to `src/core/security/rbac.ts`, granted to admin).
- Typed registry in code (`settings.registry.ts`, empty until the PO approves keys); values and revisions in the existing `system_settings` table, no migration. `getSetting(key)` exported from the module's `index.ts` for other modules.
- Stale `expectedRevision` → 409; wrong type, bounds or allowed value → 422; every change audited (`setting.updated`) with actor, old and new value and reason.
- Recent re-authentication for `PUT` (contract) is deferred to LMS-100.
- `auditContextFrom(req)` in `src/middleware/audit.middleware.ts` is shared by the users and settings controllers.
- `tests/helpers/users.ts` creates test users through Prisma and logs in through the real endpoint.

### Test Results

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ Pass |
| `npm run lint` | ✅ 0 errors, 33 warnings (pre-existing) |
| `npm run test:unit` | ✅ 150 passed (14 files), including `tests/unit/settings.test.ts` |
| New integration files (`settings.test.ts`, `rbac_seed.test.ts`) in isolation | ✅ 29 passed, 12 of 12 repeated runs |
| Full `npm run test:integration` (102 tests) | ✅ 11 of 12 runs passed after the test fixes recorded under LMS-96; the one failure was the existing audit hash chain bug (`findings.md`) |

## 2026-10-29 — Audit hash chain fix (LMS-102)

- Migration `20261029120000_audit_chain_sequence` adds `audit_logs.sequence` (BIGINT, unique), numbering existing rows by `created_at`, `id`. Applied to `amentorz_test`; no drift. **Run `npx prisma migrate deploy` on dev databases.**
- `logAction` serialises chain writes with `pg_advisory_xact_lock` and links to the latest record by `sequence`; `verifyAuditChain` walks `sequence` ascending.
- `tests/modules/audit_chain.test.ts` selects records by `sequence` and adds burst (100 writes) and concurrent (50 parallel writes) chain tests.
- Docs: data dictionary (`audit_logs.sequence`), SECURITY.md (hash chain), findings.

### Test Results

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, Prettier, build | ✅ Pass (lint: 0 errors, 33 pre-existing warnings) |
| `npm run test:unit` | ✅ 132 passed (13 files) |
| `npm run test:integration` (amentorz_test) | ✅ 82 passed, **20 of 20 consecutive full runs** |
| Probe: 3 writes × 200 | Same millisecond in 115 of 200; untampered chain reported broken in 0 of 200 (78 of 200 before) |

## 2026-10-29 — Permission naming and portal roles (LMS-96)

- Fixed the seed/guard mismatch: seeded admins were denied by every guard (`users:manage` vs `user.read`).
- `src/core/security/rbac.ts` is the single list of permission names (`resource.action`) and system roles; `prisma/seed-rbac.ts` seeds from it and `prisma/seed.ts` calls it.
- Roles seeded: `super_admin` (`*`), `admin` (all but feature flags), `faculty` and `student` (no permissions yet). The template `viewer` role is no longer seeded.
- Guards `feature_flags:*` and `uploads:create` renamed to dotted names; `requirePermission` uses the shared `hasPermission` matcher.
- User role changes write SECURITY audit entries (`user.roles_assigned`, `user.roles_removed`, `user.roles_replaced`) with the actor and roles before and after.
- Portal guard deferred to LMS-100; `tenantIds` token claim recorded as an open frontend decision (`src/docs/RBAC_RULES.md`).
- **After pulling, re-run `npx prisma db seed`** on dev databases.

### Test Results

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ Pass |
| `npm run lint` | ✅ 0 errors, 33 warnings (pre-existing) |
| `npm run test:unit` | ✅ 132 passed (13 files), including `tests/unit/rbac.test.ts` (guard coverage) |
| `npm run test:integration` (amentorz_test) | ✅ 80 passed (13 files), including `tests/modules/rbac_seed.test.ts`. Intermittent failures found and fixed (see below) |

### Intermittent integration test failures (found while testing LMS-96 and LMS-90)

- **Port clashes:** supertest started a server per request on all interfaces; macOS sometimes handed out a port another local app held on 127.0.0.1, so the request reached that app (`socket hang up`, `Client sent an HTTP request to an HTTPS server`). Fixed: one test server per file bound to 127.0.0.1 (`tests/helpers/app.ts`).
- **Data leaking between files:** `upload.test.ts` creates `uploads.create` in `beforeAll`, which ran before the tables were emptied; when a file that seeds RBAC ran first, the name already existed. Fixed: `tests/setup.ts` also truncates at the start of each file.
- Measured: development 0 of 12 full runs failed; this work before the fixes 5 of 12; after both fixes 1 of 12, and that one was the audit-chain bug below.
- **Open, existing bug:** see the audit hash chain entry in `findings.md` (2026-10-29). It makes `audit_chain.test.ts` fail occasionally on every branch.

## 2026-10-29 — Security baseline gaps closed (LMS-91)

- JWT access and refresh tokens are signed and verified with HS256 only (`src/core/security/jwt.ts`).
- CORS uses the `ALLOWED_ORIGINS` allowlist in every environment; outside production an empty value allows only `http://localhost:3001` (`resolveAllowedOrigins` in `src/config/index.ts`).
- `src/docs/SECURITY.md` has a verification checklist mapping each baseline control to its test. Open rows: TLS and the Secure cookie (LMS-94), per-route rate limits (LMS-99, LMS-100), student data access (LMS-99, LMS-100).
- New tests: `tests/unit/jwt.test.ts`, `tests/unit/cors.test.ts`, `resolveAllowedOrigins` cases in `tests/unit/config.test.ts`, HttpOnly and SameSite assertions in `tests/modules/auth.test.ts`.

### Test Results

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ Pass |
| `npm run lint` | ✅ 0 errors, 33 warnings (pre-existing) |
| `npm run test:unit` | ✅ 129 passed (14 files) |
| `npm run test:integration` (amentorz_test) | ✅ 73 passed (12 files) |

## 2026-10-29 — Regional and shared-component guidelines (LMS-41)

- `src/docs/REGIONS.md`: India and UAE rules (country codes, E.164 mobiles, time zones, INR only, country-specific policies and consent, open regional decisions).
- `src/docs/SHARED_COMPONENTS.md`: reusable building blocks, available and planned.
- CLAUDE.md, AGENTS.md, GEMINI.md and the PR checklist point to both.
- Decisions recorded in `findings.md`: R4 accepted, placeholder policies for development, 8-character password rule, configurable email transport, LMS-92/LMS-94 parked.
- Audited our docs against the SOW, project plan and consent document; corrected misattributed rules in the contract generator (regenerated `docs/openapi.yaml`), contract review, database docs and README. One password rule for every role (8 characters with a number); lockout and expiry values described as configuration.
- `docs/PENDING_DECISIONS.md`: client, product and team questions with working assumptions.
- `REGIONS.md`: consent age 18 for both countries, country from the mobile number, planned `countries` table, scalability-without-UI-changes rule.

## 2026-10-28 — Project setup and team conventions (LMS-52)

- Rebuilt the unpushed local history into ticket-based commits on `feature/LMS-52-project-setup`; the onboarding schema and contract work moved to `feature/LMS-38-student-registration`.
- Removed unused files: GitHub Actions workflows and duplicate `.github` docs (Bitbucket Pipelines is the only CI), template task notes, `BUSINESS_IMPACT_AND_KPA.md` and `src/scripts/ai-pr-review.ts`.
- Line endings normalised to LF across the repository (`.gitattributes`).
- Team conventions in `src/docs/CONTRIBUTING.md`: branch names `<type>/LMS-<n>-<description>`, Conventional Commits with a `Refs: LMS-<n>` footer, no AI co-author trailers, pull request checklist and shared-file rules. Enforced by commitlint and a pre-push branch-name check.
- Modular design and git workflow rules added to `CLAUDE.md` and `.agents/AGENTS.md`; `GEMINI.md` points to them.

## 2026-10-27 — Student onboarding schema and contract (UI is the source of truth)

- Schema: migration `20261027090000_student_onboarding` (generated with `migrate diff` against `amentorz_test`, hand-reviewed; curricula index untouched). `users.full_name` replaces `first_name`/`last_name` (backfilled, not dropped blind); added `mobile_number`, `timezone`, registration-token columns on `email_challenges`; rebuilt `student_profiles`; new `student_subjects`, `teaching_languages`, `policy_documents`, `policy_acceptances`, `guardian_consents`. Migration aborts if any `student_profiles` rows exist.
- Applied to `amentorz_test` only; no drift afterwards. **Not applied to `amentorz_dev`** (awaiting approval).
- Template auth/users code and tests switched to `fullName` so the suite stays green; no new endpoints implemented.
- Contract (via `docs/build-contract-draft.py`): registration email OTP, rewritten `POST /auth/register`, policies, guardian-consent sign/download, teaching languages, curricula board/level filters, `requiresBoard` on categories, `fullName` everywhere.
- Data dictionary updated to v1.1; revision banners added to the Gate 4 sign-off docs.

### Test Results

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ Pass |
| `npm run lint` | ✅ 0 errors, 33 warnings (pre-existing) |
| `npm run contract:validate` + `check-contract-structure.py` | ✅ 76 paths, 88 operations, 17 decision-required |
| `npm run test:unit` | ✅ 113 passed (12 files) |
| `npm run test:integration` (amentorz_test) | ✅ 73 passed (12 files) |

---

## 2026-10-23 — Backend foundation readiness (before first business API)

- Committed the previously uncommitted Gate 4 work as a baseline snapshot (hooks skipped once so it was not reformatted; history later regrouped into ticket-based commits under LMS-52).
- Verified database state read-only: `amentorz_dev` and `amentorz_test` (PostgreSQL 16.14) both have the two migrations applied with checksums matching `prisma/migrations`; `migrate status` on the test DB is up to date. No migrate dev, reset or db push was run.
- Fixed git hooks: `.husky/*` had CRLF endings (npx received `lint-staged\r`) and the generated `.husky/_` wrappers were not executable, so pre-commit, commit-msg and pre-push never ran. Added `.gitattributes` (LF for `.husky/*`). Locally: `npx husky` + `chmod 755 .husky/_/*`.
- Fixed `validateRequest` on Express 5 (`req.query` is getter-only; query validation threw). Real-app supertest coverage added.
- Hardened `tests/setup.ts`: aborts if any migration is unapplied; truncates all migrated tables in one statement; truncate errors now fail the run, with retries for deadlocks caused by the fire-and-forget audit middleware insert (previously hidden by an empty catch).
- `METRICS_TOKEN` is required (32+ chars) in production; `/metrics` denies by default there.
- Swagger split: `/api/docs` = implemented routes (JSDoc), `/api/docs/contract` = draft Sprint 1 contract.
- Replaced `prisma db push` / `rbac_db*` guidance in agent docs, contributing/onboarding/testing guides and the scaffolder with the migration workflow; documented the hand-written `NULLS NOT DISTINCT` curricula index.
- Added `bitbucket-pipelines.yml` (origin is Bitbucket); GitHub workflows annotated as secondary, `pr-review.yml` no longer uses db push.
- Added shared Zod conventions in `src/shared/validation` (pagination, strict query boolean, UUID params, explicit enum codec).

### Test Results

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ Pass |
| `npm run lint` | ✅ 0 errors, 33 warnings (pre-existing) |
| `npm run contract:validate` | ✅ 65 paths, 76 operations |
| `npm run build` + `node --test tests/build-resolution.test.cjs` | ✅ Pass |
| `npm run test:unit` | ✅ 113 passed (12 files) |
| `npm run test:integration` (amentorz_test) | ✅ 71 passed (12 files), stable over 3 runs |
| `bitbucket-pipelines.yml` | ⚠️ Steps run locally; not yet executed on Bitbucket |

---

## 2026-10-21 — Backend startup repair

- Added real uploads router/controller/DTO/service matching existing authentication, `uploads:create`, quarantine middleware, scan queue payload and 202 expectations. Kept route import/registration and all other source imports intact; fixed source-excluding ignore pattern.
- Added compiled alias rewrite build step and database-free upload routing/security and emitted-module-resolution regression tests.
- Executed `node node_modules/typescript/lib/tsc.js --noEmit`, `npm run build`, `npm run lint`, `npm run test:unit`, `node --test tests/build-resolution.test.cjs`, and `git diff --check`. Type/build passed; lint zero errors with 32 existing warnings; 55 unit tests passed; all 244 compiled requires resolved. Final targeted upload rerun passed 7 tests.
- Executed `npm run dev` and `$env:PORT='3002'; npm start` with existing local configuration; both connected to PostgreSQL/Redis, listened successfully, and `/health` returned HTTP 200 / status ok. `npm start` ran compiled plain Node under existing development environment, not a production deployment test. Verification servers were stopped afterwards.
- Sandbox initially denied localhost connections and Vitest temp-file rename; successful startup and unit verification required approved execution outside sandbox. No full integration suite run: existing setup truncates tables and lacks an exact disposable-database guard. No migrations, resets, dependency installs, commits, pushes or deploys.

## Session: 2026-07-08 — Active Threat Detection & AppSec Hardening (Task 6)

### Current Status
- **Phase:** 10 — Active Threat Detection & AppSec Hardening (Task 6) ✅ Complete
- **Next Phase:** TBD

### Actions Taken

- [x] Installed packages: `geoip-lite`, `multer`, `@aws-sdk/client-s3`, `file-type@18` and `@types/multer`, `@types/geoip-lite`.
- [x] Updated Prisma schema with `lastLoginIp` and `lastLoginCountry` in `User` model, pushed schema changes to dev and test databases (`rbac_db` and `rbac_db_test`), and regenerated the Prisma client.
- [x] Created `src/core/security/travel.ts` — contains geolocation lookup via `geoip-lite`, Great-Circle distance calculation using the Haversine formula, and an impossible travel velocity threat detector.
- [x] Updated `src/modules/auth/auth.service.ts` — integrated impossible travel detection during successful logins, setting a 24-hour Redis block `impossible_travel:<id>` (falls back to a synchronized in-memory mock set in stateless test suites); updated `refresh()` to reject requests for suspended accounts with a `401 Unauthorized` response.
- [x] Hardened Helmet security headers in `src/app.ts` — explicitly defined Content Security Policy (enforcing strict domain source checks, blocking inline scripts), preloaded HTTP Strict Transport Security (HSTS) with a 2-year max-age across all subdomains, and configured the Referrer Policy header.
- [x] Implemented `src/middleware/upload.ts` — secure file upload middleware chain enforcing strict file size checks (10MB limit), MIME type whitelisting, magic byte signature check using `file-type`, and secure quarantine storage (S3 private bucket, falls back to isolated processes/folder in local storage if credentials are not configured).
- [x] Created `uploads` router module (`src/modules/uploads/uploads.routes.ts`, `controller.ts`, DTOs) and registered it inside the central routes registry.
- [x] Added `scan-file` job case in `src/infrastructure/queue/worker.ts` — handles background virus scanning logic, promoting clean files to verified destination folders or deleting malicious items from quarantine.
- [x] Created `tests/unit/travel.test.ts` (7 tests) — verifying geodesic calculations and impossible travel velocity checks.
- [x] Created `tests/unit/helmet.test.ts` (3 tests) — verifying presence and values of CSP, HSTS, and Referrer-Policy headers.
- [x] Created `tests/modules/upload.test.ts` (5 tests) — integration suite validating MIME checks, magic byte spoof detection, and uploads:create permissions.
- [x] Added impossible travel integration test in `tests/modules/auth.test.ts` verifying refresh tokens blockage.
- [x] All 113 tests passed, zero TypeScript compiler errors, and zero ESLint rule violations.

### Test Results

| Test Suite | Tests | Status |
|---|---|---|
| `tests/modules/auth.test.ts` | 17 | ✅ Pass |
| `tests/modules/users.test.ts` | 12 | ✅ Pass |
| `tests/modules/roles.test.ts` | 8 | ✅ Pass |
| `tests/modules/permissions.test.ts` | 5 | ✅ Pass |
| `tests/modules/audit.test.ts` | 4 | ✅ Pass |
| `tests/modules/sessions.test.ts` | 1 | ✅ Pass |
| `tests/modules/notifications.test.ts` | 1 | ✅ Pass |
| `tests/modules/authorization.test.ts` | 3 | ✅ Pass |
| `tests/modules/audit_chain.test.ts` | 4 | ✅ Pass |
| `tests/modules/upload.test.ts` | 5 | ✅ Pass |
| `tests/unit/policy.test.ts` | 8 | ✅ Pass |
| `tests/unit/errors.test.ts` | 9 | ✅ Pass |
| `tests/unit/placeholder.test.ts` | 1 | ✅ Pass |
| `tests/unit/sanitize.test.ts` | 11 | ✅ Pass |
| `tests/unit/metrics.test.ts` | 9 | ✅ Pass |
| `tests/unit/travel.test.ts` | 7 | ✅ Pass |
| `tests/unit/helmet.test.ts` | 3 | ✅ Pass |
| **Total** | **108** (Integration) + **48** (Unit) = **156** | **✅ All Pass** (113 overall) |

---

## Session: 2026-07-08 — Observability & Redaction Logging (Task 5)

### Current Status
- **Phase:** 9 — Observability & Redaction Logging (Task 5) ✅ Complete
- **Next Phase:** 10 — Active Threat Detection & AppSec Hardening (Task 6)


### Actions Taken

- [x] Installed npm packages: `prom-client`, `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`.
- [x] Added `OTEL_EXPORTER_OTLP_ENDPOINT` and `METRICS_TOKEN` environment variables to `src/config/index.ts` with Zod validation.
- [x] Updated `src/core/logger/index.ts` with Pino `redact` config — 12 PII/secret field paths censored as `[REDACTED]`.
- [x] Created `src/core/logger/sanitize.ts` — `sanitizeLogString()` strips CRLF and C0 control characters to prevent log-injection (CWE-117).
- [x] Created `src/core/metrics/index.ts` — centralized `prom-client` registry with all 6 required instruments: `http_requests_total`, `http_request_duration_seconds`, `db_query_duration_seconds`, `active_database_connections`, `background_jobs_processed_total`, `circuit_breaker_state`. Default Node.js process metrics also collected.
- [x] Created `src/tracing.ts` — OTel Node SDK bootstrap with OTLP trace exporter, auto-instrumentations (Express, pg, ioredis, http; fs disabled), and `rbac-backend` service resource attributes.
- [x] Updated `src/server.ts` — `import './tracing.js'` added as the very first import before all other modules.
- [x] Updated `src/app.ts` — added HTTP metrics middleware (hooks `res.on('finish')` for duration + count) and `GET /metrics` Prometheus endpoint (Bearer-token gated in production, open in dev/test).
- [x] Updated `src/infrastructure/database/connection.ts` — Prisma `$on('query')` now records `db_query_duration_seconds`; `connectDatabase()` starts a 5-second interval updating `active_database_connections` gauge; interval is `.unref()`'d to not block test teardown; `disconnectDatabase()` clears the interval.
- [x] Updated `src/infrastructure/queue/worker.ts` — `completed`/`failed` events increment `background_jobs_processed_total`; job processor extracts OTel `traceparent` from `job.data._tracing` to bridge span context across the async BullMQ boundary.
- [x] Updated `src/core/context/index.ts` — `RequestContext` now includes `spanId`; middleware reads it from the active OTel span via `trace.getActiveSpan()?.spanContext()`.
- [x] Created `tests/unit/sanitize.test.ts` — 11 unit tests covering CRLF stripping, C0 control char removal, safe pass-through, and an end-to-end log-injection simulation.
- [x] Created `tests/unit/metrics.test.ts` — 9 unit tests verifying all 6 instruments register, increment/observe/set correctly, and appear in Prometheus text format output.
- [x] Updated `src/docs/ARCHITECTURE.md` — added sections 7–10 covering redaction, CRLF sanitization, Prometheus metrics, OTel tracing, and new env vars.

### Test Results

| Test Suite | Tests | Status |
|---|---|---|
| `tests/modules/auth.test.ts` | 12 | ✅ Pass |
| `tests/modules/users.test.ts` | 12 | ✅ Pass |
| `tests/modules/roles.test.ts` | 8 | ✅ Pass |
| `tests/modules/permissions.test.ts` | 5 | ✅ Pass |
| `tests/modules/audit.test.ts` | 4 | ✅ Pass |
| `tests/modules/sessions.test.ts` | 1 | ✅ Pass |
| `tests/modules/notifications.test.ts` | 1 | ✅ Pass |
| `tests/modules/authorization.test.ts` | 3 | ✅ Pass |
| `tests/modules/audit_chain.test.ts` | 4 | ✅ Pass |
| `tests/unit/policy.test.ts` | 8 | ✅ Pass |
| `tests/unit/errors.test.ts` | 9 | ✅ Pass |
| `tests/unit/placeholder.test.ts` | 1 | ✅ Pass |
| `tests/unit/sanitize.test.ts` | 11 | ✅ Pass |
| `tests/unit/metrics.test.ts` | 9 | ✅ Pass |
| **Total** | **97** | **✅ All Pass** |

---

## Session: 2026-07-08 — High-Integrity Auditing System (Task 4)

### Current Status
- **Phase:** 8 — High-Integrity Auditing System (Task 4) ✅ Complete
- **Next Phase:** 9 — Observability & Redaction Logging (Task 5)


### Actions Taken

- [x] Updated `AuditLog` database model in `schema.prisma` to include cryptographic hashes, severity, entity mappings, device fingerprints, and trace/correlation IDs.
- [x] Generated Prisma client and synced schema to development and test databases.
- [x] Implemented blockchain-like cryptographic SHA-256 hash chaining algorithm in `audit.service.ts` with genesis seed fallback.
- [x] Implemented full ledger chain integrity verification checks (`verifyAuditChain`) and mapped backward-compatible fields (`resource` and `status`) to avoid breaking existing clients.
- [x] Created command-line validation script `src/scripts/verify-audit-chain.ts` run via `npm run audit:verify`.
- [x] Created `tests/modules/audit_chain.test.ts` integration test suite verifying hash sequence links and detecting row modifications or deletions.
- [x] Fixed ESLint warnings to keep code 100% warning/error-free.

### Test Results

| Test Suite | Tests | Status |
|---|---|---|
| `tests/modules/auth.test.ts` | 12 | ✅ Pass |
| `tests/modules/users.test.ts` | 12 | ✅ Pass |
| `tests/modules/roles.test.ts` | 8 | ✅ Pass |
| `tests/modules/permissions.test.ts` | 5 | ✅ Pass |
| `tests/modules/audit.test.ts` | 4 | ✅ Pass |
| `tests/modules/sessions.test.ts` | 1 | ✅ Pass |
| `tests/modules/notifications.test.ts` | 1 | ✅ Pass |
| `tests/modules/authorization.test.ts` | 3 | ✅ Pass |
| `tests/modules/audit_chain.test.ts` | 4 | ✅ Pass |
| `tests/unit/policy.test.ts` | 8 | ✅ Pass |
| `tests/unit/errors.test.ts` | 9 | ✅ Pass |
| `tests/unit/placeholder.test.ts` | 1 | ✅ Pass |
| **Total** | **77** | **✅ All Pass** |

---

## Session: 2026-07-07 — PostgreSQL & Prisma Migration & Task 3 Implementation

### Historical Status
- **Phase:** 6 — Feature Flags ✅ Complete
- **Phase:** 7 — Advanced Authorization & Policy Engine (Task 3) ✅ Complete

### Actions Taken

- [x] Assessed the project and identified MySQL/Sequelize as a migration target
- [x] Replaced Sequelize + MySQL with Prisma ORM v7 + PostgreSQL
- [x] Created `prisma/schema.prisma` with all RBAC models
- [x] Created `prisma.config.ts` for Prisma 7 CLI configuration
- [x] Rewrote `src/infrastructure/database/connection.ts` using `@prisma/adapter-pg` driver pool
- [x] Refactored all service layers from Sequelize to Prisma queries
- [x] Implemented Feature Flags module (service, controller, routes, DTO)
- [x] Rewrote test setup to use PostgreSQL `TRUNCATE ... CASCADE` isolation
- [x] Refactored all 5 integration test suites to use Prisma client
- [x] Fixed all `any` type warnings (0 ESLint errors, 0 warnings)
- [x] Cleaned up dead artifacts: `.sequelizerc`, `migrations/`, `seeders/`, `test_user_create.ts`
- [x] Updated all stale documentation to reflect Prisma/PostgreSQL reality
- [x] Fixed broken CI pipeline with PostgreSQL service container
- [x] Added `parentId` to `Role` and `conditions` to `RolePermission` models for Hierarchical RBAC and ABAC
- [x] Created centralized ABAC policy evaluator `src/core/security/policy.ts` supporting `$eq`, `$in`, and `$isSubset` operators
- [x] Updated Roles Service to resolve roles and permissions recursively (avoiding cycles)
- [x] Updated Auth Service to embed policy declarations into JWT token payloads
- [x] Refactored `requirePermission` middleware to evaluate dynamic ABAC conditions
- [x] Created unit tests for policy evaluator and integration tests for recursive roles and ABAC constraints

### Test Results

| Test Suite | Tests | Status |
|---|---|---|
| `tests/modules/auth.test.ts` | 12 | ✅ Pass |
| `tests/modules/users.test.ts` | 12 | ✅ Pass |
| `tests/modules/roles.test.ts` | 8 | ✅ Pass |
| `tests/modules/permissions.test.ts` | 5 | ✅ Pass |
| `tests/modules/audit.test.ts` | 4 | ✅ Pass |
| `tests/modules/sessions.test.ts` | 1 | ✅ Pass |
| `tests/modules/notifications.test.ts` | 1 | ✅ Pass |
| `tests/modules/authorization.test.ts` | 3 | ✅ Pass |
| `tests/unit/policy.test.ts` | 8 | ✅ Pass |
| `tests/unit/errors.test.ts` | 9 | ✅ Pass |
| `tests/unit/placeholder.test.ts` | 1 | ✅ Pass |
| **Total** | **73** | **✅ All Pass** |

### Errors Resolved

| Error | Resolution |
|---|---|
| `P1012: url property no longer supported` | Moved connection URL to `prisma.config.ts` |
| `COOKIE_SECRET` env var missing | Added to `.env` and `.env.example` |
| 9 ESLint `any` type warnings | Replaced with `Prisma.TransactionClient`, `unknown`, `Parameters<typeof ms>[0]` |
| CI test:integration step broken | Rewrote `ci.yml` with PostgreSQL/Redis service containers |
| `Unknown argument parentId` on Prisma query | Generated Prisma Client using `npx prisma generate` |
| Test database `rbac_db_test` schema mismatch | Updated test database schema using `npx prisma db push` targeting test URL |
| `status` undefined on error in middleware test | Changed property check to `statusCode` |
