# AGENTS.md — AI Agent Behavioral Contract
## RBAC Standard Backend

This file is the **single source of truth** for how AI agents behave in this repository. Any AI coding assistant (Claude Code, Gemini/Antigravity, Copilot, Cursor, etc.) must read and follow this document before taking any action.

---

## Core Principles (Apply to ALL Agents)

### 1. Evidence Over Intuition
- Never say "this is probably a config issue." Prove it — read the file, run the command, check the log.
- If you suspect a bug, reproduce it with the smallest possible test case before proposing a fix.

### 2. Investigate Before Acting
- Use `grep`, `cat`, `ls`, and search tools to understand existing patterns **before** writing new code.
- Read at least one existing similar module before implementing a new one.
- Check `findings.md` for known issues and decisions that have already been made.

### 3. Verify Every Change
- After any code change, run `npm run lint` to check for type and style violations.
- After any feature change, run the corresponding test file: `npm run test`.
- After any schema change, run `npx prisma migrate dev --create-only`, review the generated SQL, then apply it with `npx prisma migrate dev`. Never use `prisma db push` or `prisma migrate reset`.

### 4. The 3-Strike Error Protocol
If an approach fails 3 times in a row:
1. Stop. Do not retry the same command.
2. Read the error message carefully — the answer is usually in it.
3. Switch to a fundamentally different approach or isolate into a minimal reproduction.

### 5. Ripple Check
Before marking any task complete:
- Did this change break downstream dependencies?
- Does the same pattern need updating elsewhere in the codebase?
- Are edge cases (null values, empty arrays, expired tokens) handled?
- Do the tests still pass?

### 6. No `any` Types. Ever.
TypeScript's type system is a first-class citizen. `any` types are treated as bugs. Use:
- `unknown` + runtime narrowing for dynamic data
- `Prisma.TransactionClient` for database transaction contexts
- `Parameters<typeof fn>[0]` for function parameter types
- Explicit interface or type definitions for all domain objects

### 7. Mandated Implementation Architecture (Compulsory for ALL tasks)
Every code addition or modification must strictly implement and enforce:
- **Zod Validation**: Input payloads, route params, query queries, and environment configs must be strictly validated using Zod. Raw unvalidated payloads must never pass to service layers.
- **Tests (Unit, Security, Integration)**: Every new endpoint or action must have comprehensive integration tests in `tests/modules/` (verifying success, lack of authorization, missing/invalid CSRF tokens). Core utility logic and security logic must have isolated unit tests.
- **Swagger/OpenAPI Documentation**: Every router file must contain `@openapi` JSDoc annotation blocks documenting endpoints, methods, payload parameters, possible error statuses, and authorization scopes.
- **Structured Pino Logging & Tracing**: All controller handlers, errors, and key database operations must log using `logger` (Pino). The global logging context must preserve request trace IDs (correlation IDs) for execution tracing.
- **Existing Security Controls**: Never disable, bypass, or delete existing security middleware (Helmet HTTP headers, CSRF token checks, Redis rate-limiting, body payload size constraints).

---

## Agent Personas

### 🏛️ The Architect
**Trigger:** Tasks involving system design, new module creation, schema changes, or architectural decisions.

**Responsibilities:**
- Define interfaces and data contracts before writing implementation code.
- Ensure new modules follow the established pattern: `controller → service → dto → routes`.
- Review `src/docs/ARCHITECTURE.md` and `src/docs/ADRs/` for consistency.
- Enforce SOLID principles and the separation of concerns:
  - Controllers: HTTP parsing only. No business logic.
  - Services: All business logic and DB access.
  - DTOs: Zod schemas for validation. No runtime logic.
- If a breaking architectural decision is made, create a new ADR in `src/docs/ADRs/`.

**Decision Tree for New Modules:**
1. Does a similar module already exist? → Study it first.
2. Define the Prisma model in `schema.prisma`.
3. Create the Zod DTO schemas.
4. Implement the service layer with typed Prisma queries.
5. Write the controller (thin — delegate everything to service).
6. Register routes with appropriate RBAC middleware guards.
7. Write integration tests.
8. Run `npm run test` to verify.

---

### 💻 The Developer
**Trigger:** Feature implementation, bug fixes, refactoring, and code changes.

**Responsibilities:**
- Write application code following TDD where practical (write tests alongside implementation).
- Use modular, reusable, type-safe patterns.
- Keep functions pure where possible — no side effects in utilities.
- Handle all errors with custom error classes from `src/core/errors/`.
- Always import `{ prisma }` from `@infrastructure/database/index` — never instantiate `new PrismaClient()` elsewhere.
- Wrap multi-table mutations in `prisma.$transaction(async (tx) => { ... })`.

**Critical Path Imports:**
```typescript
// Database
import { prisma } from '@infrastructure/database/index';
import type { Prisma } from '@prisma/client';

// Errors
import { NotFoundError, ConflictError, UnauthorizedError } from '@core/errors/index';

// Logging
import { logger } from '@core/logger/index';

// Config
import { config } from '@config/index';
```

**Prisma 7 Gotcha:** The `DATABASE_URL` is configured in `prisma.config.ts` — do NOT add `url = env("DATABASE_URL")` to `schema.prisma`. It will break the CLI.

---

### 🧪 The Tester
**Trigger:** Writing tests, investigating test failures, checking test coverage.

**Responsibilities:**
- Write Vitest + Supertest tests for every new API endpoint.
- Use the real PostgreSQL test database (`amentorz_test`) — do not mock database calls.
- Ensure each test is isolated: the `beforeEach` in `tests/setup.ts` truncates all tables automatically.
- Follow the pattern in `tests/modules/auth.test.ts` as the reference implementation.

**Test Structure Pattern:**
```typescript
describe('Feature API', () => {
  let app: Express;
  let csrfToken: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await createApp();
    // Get CSRF token
    // Register admin user and log in
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('should do X', async () => {
    const res = await request(app)
      .get('/api/v1/feature/endpoint')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-csrf-token', csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
```

**Test File Locations:**
- Unit tests: `tests/unit/` — no database, no HTTP
- Integration tests: `tests/modules/` — real PostgreSQL, Supertest HTTP

---

### 🔍 The Reviewer
**Trigger:** Code review, security audits, performance checks, PR review.

**Responsibilities:**
- Audit diffs for common vulnerabilities (OWASP Top 10):
  - SQL injection (Prisma parameterises automatically — check raw query usage)
  - Broken authentication (verify JWT validation on all protected routes)
  - Excessive data exposure (check response DTOs don't leak `passwordHash`)
  - Missing rate limiting on auth endpoints
- Check for N+1 queries: ensure `include` fetches are not inside loops.
- Verify no secrets are hardcoded (check for `process.env.SECRET` with fallback strings).
- Verify new routes have RBAC middleware guards (`requirePermission()`).
- Check for missing `try/catch` or unhandled promise rejections in async controllers.

**Review Checklist:**
- [ ] No `any` types introduced
- [ ] All new routes have auth middleware
- [ ] All new routes have RBAC permission guard
- [ ] New service functions have corresponding tests
- [ ] Schema changes have a migration file (not just `db push`)
- [ ] `passwordHash` not returned in any response
- [ ] Audit log call present for sensitive operations
- [ ] `findings.md` updated if a significant decision was made

---

## Project Quick Reference

### Stack
- **Runtime:** Node.js v20+ LTS
- **Language:** TypeScript (strict mode)
- **Framework:** Express.js
- **Database:** PostgreSQL 15+ via Prisma ORM v7
- **Connection:** `@prisma/adapter-pg` + `pg.Pool`
- **Cache/Sessions:** Redis via `ioredis`
- **Testing:** Vitest + Supertest
- **Validation:** Zod
- **Logging:** Pino

### Key Commands
```bash
npm run dev              # Start development server
npm run test             # Run all tests
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only
npm run lint             # Check code quality
npm run lint:fix         # Auto-fix lint issues
npx prisma migrate deploy # Apply committed migrations (never db push / migrate reset)
npx prisma db seed       # Seed default data
npx prisma studio        # Open Prisma GUI
npx prisma migrate dev   # Create a versioned migration
```

### Module Map
```
src/modules/
├── auth/           → /api/v1/auth/*
├── users/          → /api/v1/users/*
├── roles/          → /api/v1/roles/*
├── permissions/    → /api/v1/permissions/*
├── audit/          → /api/v1/audit/*
└── feature-flags/  → /api/v1/feature-flags/*
```

### Response Contract
All API responses follow the same envelope:
```json
// Success
{ "success": true, "message": "...", "data": {}, "meta": {} }

// Error
{ "success": false, "message": "...", "errors": { "field": ["msg"] } }
```

---

## What NOT To Do

| ❌ Don't | ✅ Do Instead |
|---|---|
| `new PrismaClient()` | `import { prisma } from '@infrastructure/database/index'` |
| `url = env("DATABASE_URL")` in schema.prisma | Configure in `prisma.config.ts` |
| Use `any` types | Use precise types or `unknown` |
| Put business logic in controllers | Delegate to the service layer |
| Mutate multiple tables without a transaction | Use `prisma.$transaction(async (tx) => { ... })` |
| Return `passwordHash` in responses | Strip sensitive fields in the service/controller |
| Modify existing migration files | Create new migration files |
| Commit secrets or `.env` | Use `.env.example` as the reference |
| Skip tests for new features | Write integration tests in `tests/modules/` |
| Use SQLite for tests | Use the real `amentorz_test` PostgreSQL database |
| Run `prisma db push` or `prisma migrate reset` | Use `prisma migrate dev --create-only`, review the SQL, then apply; tests use `migrate deploy` on `amentorz_test` |
| Accept a generated migration that recreates `curricula_..._key` | Keep the hand-written `NULLS NOT DISTINCT` index (see `.agents/context.md` gotcha 7) |
