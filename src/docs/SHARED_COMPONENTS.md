# Shared Components

Building blocks that more than one module uses. **Check this list before writing a helper**, and add an entry when you create something another module could reuse. Shared code follows the modular rules in `.agents/AGENTS.md`: domain-free helpers live in `src/shared/`, external services in `src/infrastructure/` behind an interface, and a module's reusable functions are exported from its `index.ts`.

## Available

| Component                         | Location                                                  | Use it for                                                                                         |
| --------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Request validation                | `src/middleware/validate.ts` (`validateRequest`)          | Validating body, query and params with Zod in routes                                               |
| Shared Zod schemas                | `src/shared/validation/`                                  | Pagination query, strict query booleans, UUID params, enum codecs                                  |
| Pagination                        | `src/shared/types/pagination.ts`                          | `buildPaginationMeta` and the paginated result type                                                |
| Errors                            | `src/core/errors/`                                        | Typed errors that map to HTTP status codes                                                         |
| Response envelope                 | `src/core/response/`                                      | `successResponse`, `errorResponse`                                                                 |
| Logging                           | `src/core/logger/`                                        | Structured logs with trace IDs; `sanitizeLogString` for user input                                 |
| Audit log                         | `src/modules/audit/audit.service.ts` (`logAction`)        | Recording security-relevant actions                                                                |
| Permission guards                 | `src/middleware/authenticate.ts`                          | `authenticate`, `requirePermission`                                                                |
| Permission names and system roles | `src/core/security/rbac.ts`                               | The single list of permission names (`resource.action`) and seeded roles; add new permissions here |
| Secure uploads                    | `src/middleware/upload.ts`                                | File size, type and magic-byte checks, quarantine                                                  |
| Background jobs                   | `src/infrastructure/queue/`                               | BullMQ queue and worker                                                                            |
| Test fixtures                     | `tests/helpers/`                                          | `app` and `getCsrfData`                                                                            |
| Audit context from a request      | `src/middleware/audit.middleware.ts` (`auditContextFrom`) | Actor, IP and user agent for `logAction` from a request                                            |
| Platform settings                 | `src/modules/settings/index.ts` (`getSetting`)            | Reading an admin-configurable value; add the key to `settings.registry.ts`                         |
| Test users by role                | `tests/helpers/users.ts` (`loginWithRole`)                | Creating a user with a role and logging in, in integration tests                                   |
| Contract response checks          | `tests/helpers/contract.ts` (`expectContractResponse`)    | Asserting a response matches `docs/openapi.yaml` in integration tests                              |

## Planned

| Component              | Location                                                                 | Ticket                      | Notes                                                                           |
| ---------------------- | ------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------- |
| Regions (India, UAE)   | `countries` table, `src/modules/regions/`, pure helpers in `src/shared/` | LMS-97 or LMS-99            | See `REGIONS.md`                                                                |
| Email sending          | `src/infrastructure/email/`                                              | LMS-97 (shared with LMS-79) | One interface; transport chosen by configuration (SMTP now, any provider later) |
| Per-route rate limiter | `src/middleware/`                                                        | LMS-97                      | Reused by login, OTP, recovery and consent                                      |
| File storage           | `src/infrastructure/storage/`                                            | LMS-98                      | Put and get by key with SHA-256; used by consent PDFs, policies, library        |
| PDF stamping           | `src/infrastructure/pdf/`                                                | LMS-98                      | `pdf-lib` approved                                                              |
