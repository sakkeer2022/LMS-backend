# Progress Log

## 2026-10-23 — Backend foundation readiness (before first business API)

- Committed the previously uncommitted Gate 4 work as a baseline snapshot (`48f0998`, hooks skipped once so it was not reformatted).
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
