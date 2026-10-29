# GEMINI.md — Antigravity / Gemini Instructions
## RBAC Standard Backend

This file configures Antigravity (Gemini) AI behaviour for this repository.

> **First action:** Read `.agents/AGENTS.md` for the full behavioral contract, persona definitions, and project quick reference. This file contains only Antigravity-specific additions.

---

This is a production-ready Node.js/TypeScript backend providing Role-Based Access Control (RBAC), JWT authentication, audit logging, and feature flags. It uses **PostgreSQL + Prisma v7** (with `@prisma/adapter-pg`) and **Redis**.

## Compulsory Architectural & Security Rules (Mandatory for ALL tasks)

You must strictly implement and maintain these standards on every single task:
1. **Zod Validation**: Every request payload, route parameter, query parameter, and configuration variable must be strictly validated with Zod. Never accept or process raw, unvalidated input.
2. **Vitest Testing**: Every route, service, and core utility must have corresponding automated tests (in `tests/modules/` or `tests/unit/`). Tests must cover success, authentication failure (401/403), rate limits, and CSRF token mismatches.
3. **Swagger Docs**: New routes must include OpenAPI/Swagger parameters documented via JSDoc annotations inside their respective `.routes.ts` file.
4. **Structured Pino Logging & Tracing**: Use `logger` from `@core/logger/index` to log all key handlers, operations, database errors, and context changes. Ensure trace IDs are attached and logged for requests.
5. **No Code Removal**: Do not remove, disable, or bypass any existing security protections (CSRF, helmet headers, Redis rate-limiting, body payload size constraints).

## Preferred Persona

Default to **The Developer** persona for most tasks. Switch to **The Architect** when creating new modules or making schema changes. Switch to **The Reviewer** when asked to audit or review code.

## Session Bootstrap Instructions

At the start of any session:
1. Read `.agents/AGENTS.md` for behavioral rules, decision trees, and project context.
2. Read `findings.md` to understand what's been tried and what decisions have been made.
3. Read `progress.md` to understand the current development state and pending work.
4. If working on a specific module, read `src/docs/ARCHITECTURE.md` and the relevant module source files.

After completing significant work:
- Update `progress.md` with actions taken and test results.
- Update `findings.md` if a significant technical decision was made.

## Planning Mode

For non-trivial tasks (new module, schema change, migration, refactor), **always create a plan first**:
1. Write the plan as a structured checklist.
2. Wait for user approval before executing.
3. Mark items complete as you progress.

## Implementation Workflow for New Modules

Follow the Modular Design and Git Workflow rules in `.agents/AGENTS.md` (sections 8 and 9) and `src/docs/CONTRIBUTING.md`: module `index.ts` boundaries, adapters for external services, Jira-keyed branches and commits, and no AI `Co-Authored-By` trailers.

Phase 1 serves India and the UAE: follow `src/docs/REGIONS.md` (no hard-coded country rules) and check `src/docs/SHARED_COMPONENTS.md` before writing a helper.

1. Read an existing similar module completely (e.g., `src/modules/permissions/`).
2. Create `prisma/schema.prisma` model addition.
3. Run `npx prisma migrate dev --create-only`, review the SQL, then `npx prisma migrate dev`. Never use `prisma db push`.
4. Create `[module].dto.ts` with Zod schemas.
5. Create `[module].service.ts` with Prisma queries.
6. Create `[module].controller.ts` delegating to the service.
7. Create `[module].routes.ts` with RBAC guards.
8. Register in `src/routes/index.ts`.
9. Create `tests/modules/[module].test.ts`.
10. Run `npm run test` to verify all tests pass.
11. Run `npm run lint` to ensure zero warnings.

## Key Gotchas

| Gotcha | Detail |
|---|---|
| Prisma 7 `url` in schema | Never add `url = env("DATABASE_URL")` to `schema.prisma` — it causes `P1012` error |
| Importing prisma client | Always use `import { prisma } from '@infrastructure/database/index'` |
| Test setup file order | `env-setup.ts` must load BEFORE `setup.ts` in `vitest.config.ts` |
| Test database | Tests require a real PostgreSQL `amentorz_test` database — not SQLite |
| Transaction typing | Use `Prisma.TransactionClient` (not `any`) for `tx` parameters |

## Path Aliases (from tsconfig.json)

| Alias | Real Path |
|---|---|
| `@infrastructure/database/index` | `src/infrastructure/database/index.ts` |
| `@core/errors/index` | `src/core/errors/index.ts` |
| `@core/logger/index` | `src/core/logger/index.ts` |
| `@core/security/jwt` | `src/core/security/jwt.ts` |
| `@config/index` | `src/config/index.ts` |
| `@middleware/*` | `src/middleware/*.ts` |
