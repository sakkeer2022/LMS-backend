# Knowledge transfer: category tree, pricing and faculty onboarding (2026-11-05)

For the developer taking over, and for their AI agent (Claude or similar). Read this first,
then the repo rules, then the earlier handoff it builds on:

1. Repo rules: `amentorz-backend/.agents/AGENTS.md` and `CLAUDE.md`; `AGENTS.md` in
   `amentorz-admin` and `amentorz-faculty`. The ones that bite most often:
   - no tenancy (no tenant id in URLs, query keys or claims);
   - contract first: edit `docs/build-contract-draft.py`, then run it to regenerate
     `docs/openapi.yaml` and `docs/sprint-1-endpoints.md`; check with
     `python docs/check-contract-structure.py`;
   - the UI follows the approved Figma frames; anything that changes what a screen shows
     goes into `docs/PENDING_DECISIONS.md` first;
   - commits: Conventional Commits with a `Refs: LMS-<n>` footer, **no AI co-author trailer**;
     never push to `main`/`development`, never force-push; ask before migrations, seeds,
     pushes or Jira changes.
2. Earlier handoff (still valid for the onboarding/review/consent flow):
   `docs/handoff/LMS-39-40-faculty-onboarding.md`.

This document covers what changed after it: the simplified category tree, the pricing
table, the onboarding picker, and what is still to be built.

---

## 1. Branch status

All three repos are on the same branch, **`feature/LMS-39-faculty-onboarding-pricing`**,
created from `development`. `amentorz-student` was not touched.

| Repo | Latest commits on the branch (newest first) |
|---|---|
| amentorz-backend | `ba26b19` docs(handoff): this KT · `ff25e6b` feat(pricing): add the category path to price rules · `d4b1e37` feat(categories): drop booking settings; leaves are what tutors pick · `b3c299b` feat(faculty): onboarding, review, tutor pricing gate and price consent |
| amentorz-admin | `99db327` feat(admin): pricing table as in the design, with inline bulk edit · `f59e3d6` feat(admin): simplify Categories & content to the category tree · `b674fbc` / `2702c51` shadcn port and review drawer |
| amentorz-faculty | `c305fe4` chore: sync package-lock · `24846c9` feat(faculty): pick leaf categories in the onboarding column picker · `17c0120` feat(faculty): onboarding wizard, price consent and home |

At the last fetch the branch was not behind `origin/development` in any repo. Before you
start: `git fetch && git log --oneline HEAD..origin/development` in each repo, and merge
`development` in (no rebase, no force-push) if it has moved. Open a pull request per repo
into `development` when the work is reviewed.

> Windows note: the repos are checked out with `core.autocrlf=true`. A Linux shell (WSL, a
> container) that reads the same checkout without that setting reports almost every file
> as modified (line endings only). Use `git -c core.autocrlf=true status` there.

---

## 2. Concepts you need

| Term | Meaning |
|---|---|
| **Category tree** | `categories` table, managed in Admin › Categories & content. Any depth, e.g. Academic › School › K-12 › CBSE › Physics › Class 11. |
| **Leaf** | A category with no sub-categories ("Class 11"). It is the thing a tutor teaches and a price is set for. `categories.is_bookable` is now **derived**: true exactly for leaves. |
| **Category curriculum** | Every leaf owns exactly one `curricula` row with `subject_id`, `board_id` and `level_id` all null. Kept by database triggers (below). All downstream tables (assignments, prices, consent, library) keep pointing at `curricula`. |
| **Subject card** | A tutor's choice of a leaf: one `faculty_assignments` row (faculty × curriculum). Created at onboarding (one per picked leaf). Shown as a card on onboarding 43c, as a row in Admin › Pricing, and in the admin review drawer. |
| **Tutor price** | `price_rules` row with `faculty_id` set, for one subject card. A **default price** has `faculty_id` null and applies to every tutor of that leaf. |
| **Sign-in gate** | A tutor can sign in only when approved, not suspended, and **every active subject card has an active tutor price**. Then the tutor accepts the prices (price consent) before reaching `/home`. |
| Legacy curricula | Older rows with subject/board/level on a leaf (from ADR-0005's offering model). Kept so existing assignments and prices still resolve; no picker offers them any more. |

---

## 3. What changed in this round

### 3.1 Categories & content (admin screen 28), simplified

The product decision (client, 2026-11-05): the admin manages **only the tree**: add a
category or sub-category, rename, reorder (drag and drop), enable/disable, delete. The
bookable flag, "requires board/level", allowed levels and offerings were removed.

**Backend (`d4b1e37`)**

- Migration `prisma/migrations/20261105090000_category_simple_leaves/migration.sql`
  (rollback: `prisma/rollbacks/20261105090000_category_simple_leaves.down.sql`):
  - `curricula.subject_id` becomes nullable;
  - `category_in_use(id)`: true when a student profile uses the category, or one of its
    curricula has a tutor assignment, a price rule, a learner subject or a library material;
  - `category_sync_leaf(id)`: makes a category's leaf state match its children (sets
    `is_bookable`, clears the requires flags, creates the category curriculum for a leaf,
    deletes it for a branch; raises `category_tree:CATEGORY_IN_USE` if a used leaf would
    become a branch);
  - trigger `categories_leaf_sync` (after insert, parent change, delete) and
    `categories_before_delete` (removes the leaf's own curriculum before a delete);
  - backfill: every existing leaf becomes bookable and gets its category curriculum;
    verifies with `category_tree_verify()` and aborts on any failure.
- Rule: **a leaf that is in use cannot get sub-categories** → 409 `CATEGORY_IN_USE`
  ("Class 12 is already used by tutors, prices or learners…"). Checked in the service
  (`assertCanHaveChildren` in `category-tree.tx.ts`) and by the trigger.
- Delete lists what blocks it (sub-categories, tutors, prices, learner subjects, library
  materials, student profiles, scoped levels, legacy node link); unused curricula are
  deleted with the category.
- Admin API (`src/modules/category-tree`):
  - removed `PUT /admin/category-tree/{id}/leaf-settings`,
    `GET|POST /admin/category-tree/{id}/offerings`,
    `PATCH /admin/category-tree/offerings/{curriculumId}`;
  - tree node fields: `isLeaf` and `tutorCount` replace `isBookable`, `requiresBoard`,
    `requiresLevel`, `curriculaCount`, `subtreeCurriculaCount`; stats are
    `{ categories, leaves }`; the detail drops `allowedLevels`, `activeCurriculaCount`,
    `studentCount`.
- Picker (`category-tree.picker.ts`, used by `GET /faculty/onboarding/catalogue` and
  `GET /admin/category-tree/picker`): same `OfferingTree` shape, now **one offering per
  leaf** with `subject = { id: leafId, name: leafName }`, board and level null.
  `describeOfferings()` returns `subject` = leaf name and `pathLabel` = the path **above**
  the leaf ("Academic › School › K-12 › CBSE › Physics").
- Learner catalogue (`/catalogue/category-tree/*`, behind flag `catalogue.category_tree`):
  unchanged shape; every visible leaf is listed and boards/levels are never required.
- Seeds: `prisma/seeds/catalogue.ts` no longer sets booking flags or allowed levels;
  `prisma/seed-demo.ts` builds School › K-12 › CBSE › Physics › Class 11-style paths with
  the category service and prices their category curricula.
- `docs/PENDING_DECISIONS.md`: decided row for this change; CT3 superseded; CT6 and CT7 added.

**Admin (`f59e3d6`)** — `src/features/category-tree`, `src/lib/api/category-tree*.ts`

- Matches the new Figma frame: the Active switch, Edit and Delete icons appear **only on
  the selected row**; no Bookable badge; no tree footer.
- Right column: detail card (switch, breadcrumb, status, created, count card, Add
  sub-category / Edit / Delete). **Edit** swaps it for the "Edit category" card:
  breadcrumb, **Name only**, Save, Cancel. Add category (header) and Add sub-category use the
  same one-field card; the path code is generated from the name
  (`uniqueSiblingCode`, `physics`, `physics-2`…) and never changed by a rename.
- Row count: sub-categories for a branch, tutors for a leaf. Add sub-category (and a drag
  drop) is refused up front when the leaf has tutors; the server refuses other in-use
  cases with the message shown inline.

### 3.2 Faculty onboarding picker (faculty app, `24846c9`)

`src/features/onboarding/model/picker.ts` and `components/subjects-step.tsx`: the columns
follow the admin's tree; clicking a branch opens its children, clicking a **leaf toggles a
subject card** (no board/level/subject columns any more). The card shows the leaf name
("Class 11") with the path above it. The submitted `curriculumIds` are the leaves'
category curricula.

### 3.3 Pricing page (admin screen 29, `99db327` + backend `ff25e6b`)

- Backend: price rules (`GET/POST/PUT /admin/prices`, bulk) gain **`pathLabel`**;
  `subjectName` is the leaf; `levelName` may be null. Contract updated.
- Admin table (as in the Figma frame): checkbox · **Tutor** · **Subject** (leaf name, path
  in small text below) · **Session price** · GST · Student pays · "…" menu (Edit dates,
  Deactivate). Inactive rules show an "Inactive" badge by the tutor.
- Editing: every session price is an input-style box. Clicking it selects the row and
  focuses the amount; checking rows makes them editable together; with 2+ selected, the
  card header shows **"Set all to ₹ … / Apply to N"**. A footer inside the card shows
  "N price changes not saved · GST and student totals recalculate on save", **Discard**
  and **Save N changes** (N = rows whose amount changed). GST and totals preview while
  typing; the server recalculates on save (`PUT /admin/prices/bulk`, all or nothing,
  rejected rows highlighted).
- The rule drawer's offering picker is a single "Category" select of leaf paths.
- Kept beyond the frame: search / category / status filters, "Awaiting tutor price"
  panel, "Test price resolution" panel. **Not built: Import CSV** (no backend).

---

## 4. Running it locally

```bash
# amentorz-backend
npm install
npx prisma migrate deploy        # applies 20261105090000_category_simple_leaves (and earlier)
npx prisma generate
npx prisma db seed               # reference data and RBAC
npm run db:seed:demo             # demo tree and default prices (idempotent)
npm run db:seed:users            # local admin (APP_ENV=development, DEV_ADMIN_PASSWORD)
npm run dev                      # :3000

# amentorz-admin   → http://localhost:3001/admin/categories, /admin/pricing
# amentorz-faculty → http://localhost:3003/onboarding?token=… (from an admin invitation)
npm install && npm run dev
```

- An **existing dev database** seeded before this change has demo prices on K-12's legacy
  subject curricula, so K-12 is "in use" and refuses sub-categories. Easiest: recreate the
  dev database (`npm run db:setup` on an empty database).
- The migration was written and tested on PostgreSQL 16 but **has not been run on the
  original developer's local database**; run `migrate deploy` once and check
  `SELECT * FROM category_tree_verify() WHERE failures > 0;` returns no rows.
- Checks: backend `npm run typecheck`, `npx vitest run <file>` (full suite: 62 files /
  783 tests passed, plus the later leaf path-label pricing test); admin `npm run typecheck`, `npx vitest run` (152 tests); faculty
  `npm run typecheck`, `node scripts/check-ui.cjs`, `npx vitest run` (23 tests).
- Admin's `tests/browser/category-tree-e2e.cjs` predates the tenant removal and this
  change; it needs updating before it is used again.

---

## 5. Pending work

Items 1–5 need **the new Figma frames and the exact flow from the product side before any
code**. When you (or your agent) start one, first ask for: the Figma frames (all states:
empty, loading, error, mobile if any), the exact user flow, and the open questions below.
Record each answer in `docs/PENDING_DECISIONS.md` (decided table) before building.

### 5.1 Faculty module UI (faculty app)

Today the faculty app has only: login, recovery, `/onboarding` (43b–43e), `/consent`
(price consent, placeholder design, F5) and a minimal `/home`
(`src/features/portal`). Still to build: the full portal — **dashboard, library page,
profile (incl. subject cards), and the rest of the navigation** shown in the new designs.
→ *Ask for the new Figma design for every faculty screen and the navigation map.*

### 5.2 Library page: which subject cards it lists

The library page lists the tutor's **subject cards**:

- the cards created at onboarding (one `faculty_assignments` row per picked leaf), and
- any **new cards the tutor adds later from their profile** (not built yet: needs a
  "manage subject cards" flow in the profile, reusing the onboarding column picker and
  `GET /faculty/onboarding/catalogue`'s tree, and a faculty endpoint to add/remove
  assignments, e.g. `POST/DELETE /faculty/me/subject-cards`).

A subject card is the same thing the admin prices in Admin › Pricing ("Awaiting tutor
price" / tutor price rule per card). Data: `faculty_assignments` → `curricula` (category
curriculum) → leaf `categories`; labels from `describeOfferings()` (`subject` + `pathLabel`).

### 5.3 Open decision: changing or adding a subject card after onboarding

Not decided. Questions to settle with the product owner:

1. When a tutor adds a card (or removes/changes one), **is the admin alerted**
   (email, a badge on Admin › Faculty or Pricing, both)?
2. **Does a new card need admin approval before the tutor can use it** (appear in the
   library, be bookable)? Or is it usable once priced?
3. Pricing: a new card has no tutor price. Today the sign-in gate requires every active
   card to be priced, so **adding a card would lock the tutor out** until the admin prices
   it. Options: (a) new cards start inactive/pending and are excluded from the gate until
   approved and priced; (b) the gate checks only approved cards; (c) the default price
   applies until a tutor price is set.
4. Price consent: any re-price changes the snapshot hash and asks for consent again; is
   that wanted for a newly added card?
5. Removing a card that has bookings, library material or a price: block, deactivate or
   allow?

Suggested model, if the product side agrees: add `status` (`PENDING`/`APPROVED`/`REJECTED`)
and `requested_at`/`approved_at` to `faculty_assignments`; only `APPROVED` + active cards
count for the sign-in gate, pricing "awaiting" list, library and bookings; admin gets an
"awaiting approval" list next to "Awaiting tutor price". Write it up as an F-decision first.

### 5.4 Library resources per subject card

Once a card is set up (approved and priced, per 5.3), it is listed on the **library page**;
clicking a card lets the tutor **view, add and edit library resources for that card**.
The database already has `library_materials` (title, description, kind DOCUMENT|LINK,
audience STUDENT|FACULTY|ALL, status PENDING|APPROVED|REJECTED|WITHDRAWN, `curriculum_id`,
storage key, size, MIME, external URL, scan status, uploader, revision) and
`library_reviews` (decision + notes). There is **no library module or API yet**.
Reuse `src/infrastructure/storage` (private object storage) and the document checks in
`src/modules/faculty/faculty.documents.ts` (magic bytes, size limit) for uploads.
→ *Ask for the Figma design (card list, card detail, add/edit/view resource, empty states)
and the exact flow (which file types, links allowed, edit after approval = new review?,
delete vs withdraw, who can see FACULTY-audience items).*

### 5.5 Library approval (admin)

Admin moderation of library resources: review queue, preview/download, approve or reject
with notes (`library_reviews`), what the tutor and students see per status. Pending
decision F7 suggests reusing the column picker for filtering. Tickets LMS-61/62.
→ *Ask for the Figma design for the admin queue and review screen, and the rules (who
approves, notifications, re-review on edit, malware scanning dependency F4).*

### 5.6 Other open items carried over

- **CT6** student registration and the learner catalogue still choose a subject on a leaf;
  should learners pick leaves like tutors? (student app, LMS-99)
- **CT7** in-use leaf refuses sub-categories; should admins be able to move its tutors and
  prices to a new child instead?
- **F4** no malware scanner; **F5** consent screen design not final; **F6** session rate
  and languages not collected; **F8** onboarding brand-panel numbers are placeholders;
  **F9** sign-in gate lives in LMS-100 code.
- Not done from the faculty tickets: resend/revoke invitations (LMS-80), profile editing
  (LMS-82), suspend (LMS-88).
- Pricing: Import CSV (button in the frame, no backend).

---

## 6. Where things are (quick map)

| Area | Backend | Admin | Faculty |
|---|---|---|---|
| Category tree | `src/modules/category-tree/*` (`*.tx.ts` locks and in-use check, `*.structure.ts` move/delete, `*.picker.ts` picker + labels) | `src/features/category-tree`, `src/lib/api/category-tree*.ts` | — |
| Onboarding | `src/modules/faculty/faculty.onboarding*.ts` | — | `src/features/onboarding` |
| Review / access gate / consent | `faculty.review*.ts`, `faculty.access.ts`, `faculty.consent.ts` | `src/features/faculty` (drawer 27b) | `src/features/portal` |
| Pricing | `src/modules/pricing/*` (`pricing.service.ts` views incl. `pathLabel`, `pricing.awaiting.ts`) | `src/features/pricing`, `src/lib/api/pricing.ts`, `offering-tree.ts` | — |
| Contract | `docs/build-contract-draft.py` → `docs/openapi.yaml` | follows the backend contract (Zod) | same |
| Decisions | `docs/PENDING_DECISIONS.md` | — | — |
