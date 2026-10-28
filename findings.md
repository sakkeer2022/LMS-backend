# Findings & Decisions

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


