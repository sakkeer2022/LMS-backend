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
