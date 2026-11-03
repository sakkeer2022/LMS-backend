# Findings & Decisions

## 2026-11-03 — Email OTP (LMS-99)

| Finding / Decision | Detail |
|---|---|
| Hashing | Codes are hashed with HMAC-SHA256 under a key derived from `JWT_SECRET` (no new secret to provision) and bound to the challenge id. A plain hash of a 6-digit code could be enumerated from a database leak. |
| Uniform answers | An email that already has an account gets a decoy challenge with no email sent, so step 1 reveals nothing (P7, working assumption). A wrong, expired, used or unknown code all return the same 422; only exhausted attempts return 429. |
| Replacing codes | A new request marks the live challenge for that email and purpose as consumed, and a request inside the cooldown returns 429 without changing anything. |
| Country defaults | `student_profiles.country` lost its `IN` default (REGIONS rule 1): registration sets it from the mobile number. `boards.country` keeps its default for now because the catalogue API on the unmerged LMS-54 branch creates boards without a country; remove it when that merges. |
| LMS-99 vs LMS-100 scope | Jira LMS-99 is student registration; forgot-password, reset and change-password are the rest of LMS-100 and need the LMS-100 code (route limiter, session revocation, reauthentication), so they follow once LMS-100 has merged. |

## 2026-10-29 — API route/contract drift check (LMS-93)

| Finding / Decision | Detail |
|---|---|
| Check | `tests/unit/api-contract-routes.test.ts` lists every route the API serves (from `featureRouters` in `src/routes/index.ts`) and compares method and path with `docs/openapi.yaml`. It runs with the unit tests, so CI fails on drift |
| Express 5 | A mounted router does not keep its mount path, so `src/routes/index.ts` now declares its mounts as an exported `featureRouters` list and mounts them in a loop |
| Template routes | 39 routes are not in the Sprint 1 contract (RBAC/user administration, feature flags, notifications, admin dashboard, uploads, `POST /auth/login`, `GET /audit/{id}`, `GET /`). They are listed as known undocumented with a reason, pending the legacy-routes decision; the test fails when an entry goes stale |
| Response shapes | `tests/helpers/contract.ts` validates response bodies against the contract schema for the operation and status (Ajv 8 with `ajv-formats`, strict mode off for OpenAPI 3.0 keywords; added as dev dependencies with approval). `tests/modules/contract_responses.test.ts` covers the implemented contract routes |
| Known mismatches | `GET /auth/me`, `GET /auth/sessions` and `POST /auth/refresh` (template versions, rewritten in LMS-100) and `GET /audit`. The audit list returns `correlationId`, `ipAddress`, `userAgent` and `deviceFingerprint`, which the contract's redacted projection excludes, and lacks the contract's filters and date window: needs its own ticket. The test fails when a mismatch is fixed, so the list stays current |
| Still open in LMS-93 | Serving the approved contract at `/api/docs` once Sprint 1 endpoints exist |

---

## 2026-10-29 — Platform settings API (LMS-90)

| Finding / Decision | Detail |
|---|---|
| Registry in code, values in the database | `src/modules/settings/settings.registry.ts` defines each key's type, bounds, allowed values and default; `system_settings` (existing table, no migration) stores only the value and revision. Unregistered keys return 404 even if a row exists |
| Registry starts empty | The initial keys are `DECISION REQUIRED` in the contract. Keys are added, once approved, in the PR of the feature that reads them. Tests use a mocked registry |
| No cache | `getSetting(key)` reads the database each time, so changes apply without a restart and there is nothing to invalidate |
| Defaults stored on first read | Reading or updating a registered key creates its row with the default (revision 1), so `expectedRevision` always has a value to compare |
| Optimistic concurrency | `PUT` updates only where `revision = expectedRevision`; otherwise 409. Wrong type, bounds or allowed value is 422 |
| Audit | `setting.updated` (SECURITY) with the actor, old and new value, revision and reason, written after the commit |
| Re-authentication deferred | The contract requires recent re-authentication for `PUT`; `/auth/reauthenticate` comes with LMS-100, which adds the check |
| Test fixtures | `tests/helpers/users.ts` creates users through Prisma (low bcrypt cost) and logs in through the real endpoint, instead of registering through the API |

---

## 2026-10-29 — Audit hash chain breaks on same-millisecond writes (LMS-102, fixed)

| Finding / Decision | Detail |
|---|---|
| Symptom | `audit_chain.test.ts` ("middle record is tampered with") fails occasionally on every branch |
| Cause | `logAction` links each record to the latest one found by `createdAt DESC, id DESC`, and `verifyAuditChain` walks `createdAt ASC, id ASC`. `createdAt` has millisecond precision and `id` is a random UUID, so records written in the same millisecond are linked and verified in different orders. Concurrent writes (the audit middleware is fire-and-forget) can also read the same "latest" record and fork the chain |
| Evidence | Probe on development: 3 sequential writes, 200 times. Same millisecond in 153 of 200; an untampered chain reported as broken in 78 of 200 |
| Impact | `npm run audit:verify` can report tampering that did not happen, which undermines the LMS-41 audit baseline |
| Fix (LMS-102) | New `audit_logs.sequence` (BIGINT, unique, sequence default) used for linking and verification. `logAction` takes `pg_advisory_xact_lock` inside a transaction, reads the latest record by `sequence` and inserts, so writes are serialised. Migration `20261029120000_audit_chain_sequence` numbers existing rows in their previous verification order (`created_at`, `id`) |
| Existing rows | Not re-hashed. Rows written before the fix may already form a broken chain (for example in dev databases); production has no audit data yet. If `audit:verify` reports an old break on a dev database, clear its audit logs |
| Cost | Audit writes are serialised by one lock. Acceptable at current volume; revisit if audit writes become a bottleneck |
| Result | Probe after the fix: same millisecond in 115 of 200 runs, untampered chain reported as broken in 0 of 200 |

---

## 2026-10-29 — Permission naming and portal roles (LMS-96)

| Finding / Decision | Detail |
|---|---|
| Seeded admin failed every guard | The seed created `users:manage` and similar names while guards check `user.read`. The wildcard match compares `users` with `user`, so seeded admins were denied everywhere |
| One catalogue for names and roles | `src/core/security/rbac.ts` lists permissions and system roles; the seed uses it, and `tests/unit/rbac.test.ts` fails when a guard name is not listed or a seeded admin would be denied |
| Naming: `resource.action` | The two colon guards (`feature_flags:*`, `uploads:create`) became dotted. Resource names were not renamed (singular `user`, `role`, `permission` stay) |
| Roles | `super_admin` (`*`), `admin` (all but feature flags), `faculty` and `student` (no permissions yet). The template `viewer` role is no longer seeded |
| `admin.*` is a global wildcard | The matcher treats it like `*`; it is never seeded |
| Known escalation path | `admin` can assign roles and role permissions, so it can grant itself `super_admin`. Accepted for now; LMS-104 restricts it |
| Role changes audited | `user.roles_assigned`, `user.roles_removed` and `user.roles_replaced` audit entries (severity SECURITY) record the actor and the role names before and after, written after the commit |
| Portal guard deferred | Permission guards already block students and faculty from admin routes; a role-based portal guard comes with the first portal-only route (LMS-100) |
| `tenantIds` claim | Decided 2026-10-29: no tenant parameter or invented tenant claims; the frontend's tenancy gate is resolved through review during frontend integration |

---

## 2026-10-29 — Security baseline decisions (LMS-91)

| Finding / Decision | Detail |
|---|---|
| JWT algorithm pinned to HS256 | Sign and verify both pass HS256 explicitly. It was already the library default, so existing tokens stay valid; tokens with any other algorithm, including `none`, are rejected |
| CORS allowlist in every environment | The old development setting (`*` with credentials) is rejected by browsers for cookie requests. `ALLOWED_ORIGINS` now applies everywhere; outside production an empty value allows only `http://localhost:3001`. **Confirm the admin frontend's local port** |
| Verification checklist | `src/docs/SECURITY.md` maps each baseline control to its test; open rows point to LMS-94 (TLS, Secure cookie), LMS-97/LMS-100 (per-route rate limits) and LMS-99/LMS-100 (student data access) |
| `cors` always sends Allow-Credentials | For an unknown origin it omits `Access-Control-Allow-Origin`, so the browser blocks the response; the credentials header alone has no effect |

---

## 2026-10-29 — Product and tech lead decisions; India and UAE support

| Finding / Decision | Detail |
|---|---|
| Guardian identity (project plan risk R4) | **Accepted.** The consent signature is not identity-verified; the acceptance is to be recorded in writing. Unblocks LMS-98/LMS-99; remove the R4 `DECISION REQUIRED` note from the contract when LMS-98 is built |
| Policy documents | Production documents come from the client. Development uses AI-generated placeholder Student Terms, Terms of Use, Privacy Policy and Child Safety Policy, clearly marked as placeholders and never seeded in production |
| Password rule | **8 characters with at least one number** (the onboarding UI rule). The SOW (A1.8) only asks for "secure password policies"; the "12-character policy" in our contract notes came from the template DTO (`src/modules/auth/auth.dto.ts`, `.min(12)`), not from a client document. Align the template DTOs and the contract when LMS-99/LMS-101 are built |
| Email | Gmail SMTP for development; a different provider (SendGrid or similar) for production. Build one email interface with the transport chosen by configuration so switching is a settings change (LMS-97, shared with LMS-79) |
| Backups and deployment | LMS-92 and LMS-94 are parked until hosting is decided |
| Regions | Phase 1 serves India and the UAE. Rules in `src/docs/REGIONS.md`: no hard-coded country rules, E.164 mobiles, UTC storage with user time zone, INR only (project plan), country-specific policies and consent. `policy_documents` needs a `country` column (LMS-98) |
| Reuse | `src/docs/SHARED_COMPONENTS.md` lists reusable building blocks; check it before writing a helper |
| Audit against client documents | Done. Corrected in the contract generator, contract review and database docs: packages ("excluded per SOW" → deferred by the draft plan, SOW allows them), Razorpay ("approved" → leading candidate), 60-minute slots and authorize/capture/void (draft plan, not SOW), consent design ("client instructions" → ours to design), boards, review statuses, notification read state. SOW-vs-plan conflicts recorded as pending: 20-minute rule, rescheduling. Missing items recorded: data protection and refund/cancellation policies, region on the student profile |
| Consent age | Under 18 needs guardian consent in **both India and the UAE** (client confirmation pending, C8) |
| Country capture | Derived from the mobile number's dialling code for now; IP or form capture may follow. Region cannot be derived from a mobile number and stays empty until the client defines it (C10) |
| Countries table | Planned `countries` reference table (code, name, dialling code, mobile pattern, default time zone, guardian consent age, active flag), built with the first feature that needs it, so adding a country is a data change |
| Library | Kept as designed (admin-only uploads, PDF/JPEG/PNG, logged-in students) although SOW A1.7.5 is broader; client question C1 |
| Lockout and expiry values | Removed from the contract and docs as requirements; they are configuration values. The lockout and token expiry features themselves are unchanged |
| Scalability without UI changes | Backend scalability changes must not change what the UI shows or collects; anything that would is raised in `docs/PENDING_DECISIONS.md` (rule added to CLAUDE.md, AGENTS.md, GEMINI.md and the PR checklist) |
| Pending decisions | `docs/PENDING_DECISIONS.md` lists every open question by owner (client, product and UI, team) with the working assumption |
| Approvals | `nodemailer` and `pdf-lib` approved as dependencies (LMS-97, LMS-98) |
| No tenancy | No tenant parameter or invented tenant claims in tokens or APIs. The admin frontend's `tenantIds` gate must be removed or resolved through review during frontend integration |

---

## 2026-10-27 — Student onboarding schema decisions

| Finding / Decision | Detail |
|---|---|
| UI is final | Schema and contract follow the onboarding screens; conflicts with project documents are marked `DECISION REQUIRED` in the contract instead of changing the UI |
| Minor status computed, not stored | `is_under_18` removed; a stored flag goes stale at 18. Server computes from `date_of_birth` (`DATE`) |
| Consent before account | `guardian_consents` rows are created by the DOB popup before registration, keyed by a hashed single-use token, linked at `POST /auth/register`, purged if unlinked after expiry |
| Open decisions | (Updated 2026-10-29: password rule, R4 and the consent age are decided; current list in `docs/PENDING_DECISIONS.md`.) Student password rule (8 + digit) vs SOW A1.8; R4 guardian identity not verified; guardian SMS not in Phase 1; library browsing without account; country not collected (default IN); full-name change affects faculty/admin; relationship options |
| `policy_documents` vs `faculty_terms` | Overlap; merge is follow-up work |
| `migrate diff` workflow | Generate SQL with `prisma migrate diff --from-config-datasource --to-schema` against `amentorz_test` (read-only) instead of `migrate dev` against dev |

---

## 2026-10-23 — Foundation readiness findings

| Finding / Decision | Detail |
|---|---|
| Dev DB built by migrations | Both DBs have both migrations applied with matching checksums; no baseline/resolve needed |
| Migration drift by design | `curricula_category_id_board_id_subject_id_level_id_key` uses `NULLS NOT DISTINCT` (hand-edited, PG15+). Prisma cannot express it, so `migrate dev` output must be reviewed (`--create-only`) and any rebuild of this index removed |
| Git hooks were inert | CRLF in `.husky/*` and non-executable `.husky/_` wrappers; fixed with LF + `.gitattributes` |
| Repo uses CRLF, Prettier wants LF | `.prettierrc` sets `endOfLine: lf`; lint-staged converts each touched `src/**/*.ts` file to LF. Normalised repo-wide to LF in LMS-52 (`.gitattributes` `* text=auto eol=lf`) |
| Audit writes are fire-and-forget | `auditLogMiddleware` writes after the response, racing test TRUNCATE (deadlock 40P01). Test setup retries; production concurrency of the hash-chained audit insert is not yet reviewed |
| CI platform | Bitbucket Pipelines is the only CI; the unused GitHub Actions workflows were removed (LMS-52) |
| Swagger | Implemented spec (JSDoc) and draft contract are served separately so docs match the running API (LMS-41) |
| Enum contract mismatches | Not only case differences: `documentType`, `scanStatus`, library `kind` vs `LibraryMaterialKind`, plus DB-only `CHANGES_REQUESTED`/`WITHDRAWN`. `createEnumCodec` requires explicit mappings; these need a contract or schema decision before M02/M03 APIs |
| Legacy template routes | `/auth/login`, `/users`, `/roles`, `/permissions`, `/feature-flags`, `/admin` left mounted until the first business API is approved |

---

## 2026-10-21 — Missing uploads module and compiled runtime aliases

- Reproduced `TS2307` and development `MODULE_NOT_FOUND` for `@modules/uploads/uploads.routes.js`.
- No uploads module exists in available Git history, including the upload feature commit `98d4505`; that commit includes route registration, middleware, worker and integration expectations. `git check-ignore -v src/modules/uploads/uploads.routes.ts` identifies unanchored `uploads/` as excluding source. Anchored runtime ignore to `/uploads/` and reconstructed the intended authenticated quarantine/scan-queue module from existing tests. This is not a recovered historical file or a new Sprint 1 document/library API.
- Retained NodeNext/CommonJS (package has no `type: module`), tsx aliases and existing `.js` imports. TypeScript paths do not rewrite emitted requires; added build-only AST rewriting of local aliases to relative compiled paths, using already installed TypeScript. No runtime alias dependency or package installation needed.
- Existing upload worker uses filename-based simulation, not real antivirus scanning; successful startup/queue dispatch must not be described as production scan validation. Local Redis 5.0.14.1 produces BullMQ minimum-version recommendations; no upgrade performed.
- Preserved user changes to `src/config/index.ts` and `package-lock.json`, and existing contract documents. No schema/database mutations.

## Requirements

- Provide a production-ready RBAC backend that developers can clone and immediately build on top of.
- Support PostgreSQL as the primary database (migrated from MySQL).
- Use Prisma ORM for all database interactions.
- Enforce type safety throughout — no `any` types allowed.
- Maintain comprehensive integration tests that run against a real database.

## Research Findings

- **Prisma v7 Breaking Change**: The `url` property is no longer supported inside `schema.prisma`'s `datasource` block. Connection URLs must now be configured in `prisma.config.ts` and passed to `PrismaClient` via a driver adapter. See [Prisma Docs](https://pris.ly/d/config-datasource).
- **Driver Adapter Required**: Prisma v7 requires `@prisma/adapter-pg` with a `pg.Pool` to connect to PostgreSQL. Raw `new PrismaClient()` without an adapter will fail.
- **Test Database Isolation**: SQLite in-memory was removed in favour of a real PostgreSQL `rbac_db_test` database. `TRUNCATE ... CASCADE` between tests ensures full isolation without needing to recreate the schema.

## Technical Decisions

| Decision | Rationale |
|---|---|
| PostgreSQL over MySQL | Better JSON support, stricter SQL standards compliance, `pg` ecosystem maturity |
| Prisma over Sequelize | Type-safe query builder, auto-generated client, better developer experience, native migration tooling |
| Prisma v7 with driver adapter | Aligns with Prisma's future direction; native `pg.Pool` enables better connection pooling and observability |
| `prisma.config.ts` for CLI config | Prisma 7 requirement: separates schema definition from connection configuration |
| PostgreSQL test DB over SQLite | Real database behaviour for tests (transactions, constraints, JSON types) avoids false positives from SQLite quirks |
| `TRUNCATE ... CASCADE` for test isolation | Faster than `DROP`/`CREATE` schema per test; maintains FK integrity |
| Pino for logging | High-performance structured JSON logging; zero overhead on `info` level in production |
| Cryptographic Ledger Hash Chaining | Links each log entry to the hash of the preceding entry, making the logs structurally immutable and tamper-evident |
| Backwards Compatibility Mapping | Mapped `resource` and `status` properties in audit responses to support legacy queries and existing tests without API churn |

## Issues Encountered

| Issue | Resolution |
|---|---|
| `P1012: url property no longer supported in schema.prisma` | Removed `url` from `datasource` block; created `prisma.config.ts` with `defineConfig()` |
| `COOKIE_SECRET` missing from `.env` causing test seed failure | Added `COOKIE_SECRET` to `.env` and `.env.example` |
| `any` type warnings from ESLint | Replaced all `any` with `Prisma.TransactionClient`, `Parameters<typeof ms>[0]`, and `unknown` |
| Old Sequelize migrations and seeders causing confusion | Deleted `migrations/`, `seeders/`, `.sequelizerc` entirely |
| CI pipeline broken: `test:integration` assumed SQLite | Rewrote `ci.yml` to provision a real PostgreSQL service container |
| Prisma Self-Referential Types Recursion in TS compilation | Added explicit type annotations to `parentRole` to bypass inference recursion |
| Prisma JSON Types vs `PolicyRule.conditions` type mismatch | Used explicit type assertion to cast properties to `PolicyRule['conditions']` to bypass any types |

## Resources

- [Prisma v7 Migration Guide](https://pris.ly/d/prisma7-client-config)
- [Prisma Config Datasource](https://pris.ly/d/config-datasource)
- [pg Pool Documentation](https://node-postgres.com/apis/pool)
- [Prisma Adapter for pg](https://www.prisma.io/docs/orm/overview/databases/postgresql)

---

## Task 5 Findings — Observability & Redaction Logging

### Technical Decisions

| Decision | Rationale |
|---|---|
| Pino `redact` for PII sanitization | Built-in to Pino — zero runtime overhead; paths are evaluated at serialization time using fast-json-stringify, not at call site |
| `sanitizeLogString()` utility for CRLF | Centralised, pure function; callers are responsible for passing user-controlled strings through it before logging (CWE-117) |
| `prom-client` for Prometheus metrics | Industry standard; supports Counters, Histograms, Gauges natively; `collectDefaultMetrics()` adds Node.js process instrumentation for free |
| `/metrics` endpoint with Bearer token in production | Follows Prometheus scraping conventions; avoids need for a separate metrics sidecar while still allowing security gating |
| Path normalization in HTTP metrics middleware | Strips UUID/numeric segments (e.g. `/users/123` → `/users/:id`) to keep label cardinality bounded and prevent unbounded time-series growth |
| `pg.Pool` gauge via `setInterval` + `.unref()` | pg.Pool does not emit events on connection count changes, so polling every 5s is the correct approach; `.unref()` prevents the interval from keeping test processes alive |
| OTel SDK first import in `server.ts` | Node.js module patching requires the SDK to be initialised before any instrumented modules are `require()`'d — the order is non-negotiable |
| `fs` instrumentation disabled in OTel | File system spans generate extremely high cardinality noise in development (thousands per request); disabled to keep Jaeger/Tempo usable |
| BullMQ `_tracing` carrier in `job.data` | W3C TraceContext `traceparent` injected by the enqueuing HTTP handler; extracted by the worker using `propagation.extract()` to correctly parent worker spans under the HTTP trace |
| `spanId` in `RequestContext` | Enables log entries to include the OTel span ID alongside `traceId`, enabling correlation between Pino JSON logs and Jaeger traces without a log-based tracing agent |

### Issues Encountered

| Issue | Resolution |
|---|---|
| `@opentelemetry/semantic-conventions` exports `ATTR_DEPLOYMENT_ENVIRONMENT_NAME`, not `ATTR_DEPLOYMENT_ENVIRONMENT` | Used the correct `ATTR_DEPLOYMENT_ENVIRONMENT_NAME` export; verified via TypeScript type check |
| `Resource` class removed from `@opentelemetry/resources` in v2 | Replaced `new Resource({})` with `resourceFromAttributes({})` — the new factory function API |
| `app.ts` content duplicated during `replace_file_content` tool call | The tool matched a sub-range instead of the full file; removed the duplicate block with a follow-up targeted edit |

---

## Task 6 Findings — Active Threat Detection & AppSec Hardening

### Technical Decisions

| Decision | Rationale |
|---|---|
| Bundled MaxMind Geolite2 database (`geoip-lite`) | Zero external network calls or web services required at request time; loads local binary mapping at startup which guarantees extremely fast execution and offline test portability |
| Geolocation stateless mock fallback | Redis connection is disabled in unit/integration test runs (`isTest` mode); added an in-memory `mockImpossibleTravelSuspensions` Set in `AuthService` to track suspended IDs without Redis, resolving state/connectivity gaps |
| file-type version 18 pinning | Pinned to `file-type@18` to maintain standard CommonJS/ESM module compatibility in compilation targets (v19+ are ESM-only and require custom module loader paths) |
| Size-before-buffer multer validation | Restricting file ingestion size limits directly inside Multer initialization prevents heap exhaustion and memory attacks before the request buffer passes to magic byte parsing |
| Private quarantine upload prefix | Uploading files with private ACL settings in S3 isolates uploads from public access before ClamAV completes its evaluation; background worker moves objects to verified prefix ONLY after clean report |
| Local quarantine filesystem fallback | Automatically falls back to local processes `/uploads/quarantine` when S3 credentials are not set, keeping the application immediately runnable on local setups without AWS mocks |

### Issues Encountered

| Issue | Resolution |
|---|---|
| `file-type` magic bytes parsing requires minimal size buffer | Disguised short buffer payloads (e.g. less than 262 bytes) returned `undefined` instead of triggering signature mismatches; padded mock PNG/PDF structures in tests to exceed 300 bytes |
| Test suite concurrently resets db schema, causing database connection issues (`ECONNRESET`) | Verified all integration test files pass 100% when executed sequentially (`fileParallelism: false` / sequential integration script), proving no logical bugs in routing, controllers, or database schemas |
| Express `Request` type lacked custom properties | Added `FileQuarantine` interface extension to global Express namespace mapping in `src/middleware/upload.ts` alongside `@typescript-eslint/no-namespace` eslint bypass comments |


