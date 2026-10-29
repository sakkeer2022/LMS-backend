# CLAUDE.md — Claude Code Instructions
## RBAC Standard Backend

This file configures Claude Code's behaviour for this repository.

> **First action:** Read `.agents/AGENTS.md` for the full behavioral contract, persona definitions, and project quick reference. This file contains only Claude Code-specific additions.

---

This is a production-ready Node.js/TypeScript backend providing Role-Based Access Control (RBAC), JWT authentication, audit logging, and feature flags. It uses **PostgreSQL + Prisma v7** (with `@prisma/adapter-pg`) and **Redis**.

## Compulsory Architectural & Security Rules (Mandatory for ALL tasks)

You must strictly implement and maintain these standards on every single task:
1. **Zod Validation**: Every request payload, route parameter, query parameter, and configuration variable must be strictly validated with Zod. Never accept or process raw, unvalidated input.
2. **Vitest Testing**: Every route, service, and core utility must have corresponding automated tests (in `tests/modules/` or `tests/unit/`). Tests must cover success, authentication failure (401/403), rate limits, and CSRF token mismatches.
3. **Swagger Docs**: New routes must include OpenAPI/Swagger parameters documented via JSDoc annotations inside their respective `.routes.ts` file.
4. **Structured Pino Logging & Tracing**: Use `logger` from `@core/logger/index` to log all key handlers, operations, database errors, and context changes. Ensure trace IDs are attached and logged for requests.
5. **No Code Removal**: Do not remove, disable, or bypass any existing security protections (CSRF, helmet headers, Redis rate-limiting, body payload size constraints).

## Modular Design Rules (Mandatory for ALL feature work)

Every feature is built as a self-contained module. These rules extend the `controller → service → dto → routes` pattern in `.agents/AGENTS.md`; they do not replace it.

1. **One module per bounded concern**: `src/modules/<name>/` holds `<name>.routes.ts`, `<name>.controller.ts`, `<name>.service.ts` and `<name>.dto.ts`, plus an `index.ts` that is the module's only public surface (its router and the service functions other modules may call). Every new module has an `index.ts`; template modules get one the next time they are changed. Split a module before a service file grows past roughly 400 lines; do not keep adding unrelated flows to `auth.service.ts`.
2. **No reaching into other modules**: import another module only through its `index.ts`, never its controller, dto or internal helpers. Cross-module work goes through that module's exported service functions. Accept an optional `tx: Prisma.TransactionClient` on any function that must join another module's transaction.
3. **External concerns live behind interfaces in `src/infrastructure/`**: email, object storage, PDF generation, clock and similar adapters expose a small TypeScript interface with a production implementation and an in-memory test double. Services depend on the interface, never on an SDK (`@aws-sdk/*`, mail or PDF libraries) directly.
4. **Shared, domain-free helpers only in `src/shared/`**: validation primitives, pagination and types. Domain rules (for example age or eligibility checks) belong to the module that owns them and are exported from its `index.ts`.
5. **Routing is wired in one place**: a module exports its router from `index.ts` and it is mounted only in `src/routes/index.ts`. Route-specific rate limits, guards and upload middleware are applied in the module's own routes file.
6. **Tests mirror modules**: integration tests in `tests/modules/<name>.test.ts` and unit tests for the module's pure logic in `tests/unit/`. Test fixtures create data through `tests/helpers/` factories, not through another module's HTTP endpoints, so changing one module's API does not break unrelated suites.
7. **Contract first**: a module's endpoints must match `docs/openapi.yaml` (generated from `docs/build-contract-draft.py`). Change the generator and regenerate the contract before or with the code, never after.
8. **India and UAE**: Phase 1 serves both countries. Never hard-code a country, dialling code, time zone, currency or age rule in a module; use the shared region helpers and follow `src/docs/REGIONS.md`. Country-specific content (policies, consent) is chosen by the user's country.
9. **Reuse before you write**: check `src/docs/SHARED_COMPONENTS.md` before writing a helper, and add an entry when you create something another module could use.

## Git Workflow (Mandatory)

Branch names, commit messages and pull requests follow `src/docs/CONTRIBUTING.md`:
- Branch: `<feature|bugfix|hotfix|release>/LMS-<ticket>-<short-kebab-description>`, created from `development`.
- Commit: Conventional Commits with a `Refs: LMS-<ticket>` footer.
- **Never add a `Co-Authored-By` trailer or any other AI attribution** to commits or pull requests. commitlint rejects it.
- Never push to `main` or `development` directly, never force-push a shared branch, and never push without the developer's go-ahead.

## Preferred Persona

Default to **The Developer** persona for most tasks. Switch to **The Architect** when creating new modules or making schema changes. Switch to **The Reviewer** when asked to audit or review code.

## Memory Instructions

At the start of any session:
1. Read `.agents/AGENTS.md` for behavioral rules and project context.
2. Read `findings.md` for known decisions and resolved issues.
3. Read `progress.md` to understand the current development state.
4. If working on a specific module, read the relevant file in `src/docs/`.

After completing significant work:
- Update `progress.md` with what was done and the test results.
- Update `findings.md` if a new technical decision was made.

## Claude-Specific Behaviour

- **Prefer `TodoWrite` for multi-step tasks** — break complex features into tracked items.
- **Run tests after every meaningful code change** — use `Bash` to run `npm run test`.
- **Use Bash to verify** before assuming anything works.
- **Do not truncate code in artifacts** — show complete file contents when writing code.

## Tool Usage Priorities

1. Read existing code with `Read` before writing new code.
2. Use `Grep` to find existing patterns before implementing new ones.
3. Use `Bash` to verify changes actually work.
4. Use `Write`/`Edit` only after understanding the full context.

## Key File Paths

| Alias | Real Path |
|---|---|
| `@infrastructure/database/index` | `src/infrastructure/database/index.ts` |
| `@core/errors/index` | `src/core/errors/index.ts` |
| `@core/logger/index` | `src/core/logger/index.ts` |
| `@core/security/jwt` | `src/core/security/jwt.ts` |
| `@config/index` | `src/config/index.ts` |
| `@middleware/*` | `src/middleware/*.ts` |

These path aliases are configured in `tsconfig.json`.
