# Testing Strategy

## Philosophy

Quality is non-negotiable. The platform requires a minimum of **80% test coverage** globally.

## Frameworks

- **Backend**: Vitest for unit/integration testing, Supertest for API contract/E2E testing.
- **Frontend**: Vitest for component and hook testing, React Testing Library for DOM assertions.

## Test Categories

### 1. Unit Tests

- Mandatory for all standalone utilities, DTO mappings, and complex business logic inside services.
- Database and external services should be mocked to isolate service logic.
- Go in `tests/unit/` — must **not** import `tests/setup.ts` or touch the database.

### 2. Integration Tests

- Validates the entire request-response lifecycle (Router → Middleware → Controller → Service → Database → Response).
- Uses a **real PostgreSQL test database** (`amentorz_test`) for authentic data interactions.
- Go in `tests/modules/` — always require a running PostgreSQL instance and import `tests/setup.ts`.

### 3. API Contract & E2E Tests

- Validates HTTP status codes and strict adherence to the defined API JSON contracts (see `src/docs/API_CONTRACTS.md`).
- Uses Supertest to make real HTTP requests against the running Express app.

### 4. Middleware & Permission Tests

- Specific isolated tests for the RBAC middleware (`hasPermission`, `hasRole`).
- Must verify that missing tokens, invalid tokens, and missing permissions correctly return `401 Unauthorized` or `403 Forbidden`.

## Test Scripts

| Script | Directory | Uses DB | Parallelism | When to Run |
|---|---|---|---|---|
| `npm run test:unit` | `tests/unit/` | No | Yes | pre-push, frequently during dev |
| `npm run test:integration` | `tests/modules/` | Yes (PostgreSQL) | No | CI, before PR |
| `npm run test` | all | Yes (PostgreSQL) | No (sequential) | CI default / full local check |
| `npm run test:coverage` | all | Yes (PostgreSQL) | No | On demand |
| `npm run test:watch` | all | Yes (PostgreSQL) | No | Interactive dev |

## Test Environment Bootstrap

`npm run test` requires a running PostgreSQL instance with the `amentorz_test` database created.

### How it Works

Vitest loads `setupFiles` in this exact order before any test module is imported:

1. **`tests/env-setup.ts`** _(runs first)_ — populates all required environment variables with fake, deterministic values. Overrides `DATABASE_URL` to point at `amentorz_test`.
2. **`tests/setup.ts`** — imports `src/config/index.ts`, connects the Prisma client, and registers `beforeEach` hooks to `TRUNCATE` all tables (ensuring test isolation).

> **Do not reorder these files.** If `tests/setup.ts` runs first, `src/config/index.ts` will throw `Missing required environment variables` before the fake values are set.

### Environment Variables Set for Tests

| Variable | Fake Value |
|---|---|
| `NODE_ENV` | `test` |
| `DATABASE_URL` | `postgresql://<user>@localhost:5432/amentorz_test?schema=public` |
| `JWT_SECRET` | `test-jwt-secret-deterministic` |
| `JWT_REFRESH_SECRET` | `test-jwt-refresh-secret-deterministic` |
| `COOKIE_SECRET` | `test-cookie-secret-deterministic` |

All other config values (e.g., `PORT`, `REDIS_URL`) use safe `??` fallbacks defined in `src/config/index.ts`.

### Adding a New Required Variable

If `src/config/index.ts` gains a new required variable:

1. Add a fake deterministic value to `tests/env-setup.ts` using the `??=` operator.
2. Do **not** add test conditionals (`process.env.NODE_ENV === 'test'`) to production config files.
3. Update the table above.

### Setting Up the Test Database

```bash
psql -d template1 -c "CREATE DATABASE amentorz_test;"
DATABASE_URL="postgresql://youruser@localhost:5432/amentorz_test?schema=public" npx prisma migrate deploy
```
