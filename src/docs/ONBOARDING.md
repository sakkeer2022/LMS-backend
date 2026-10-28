# Developer Onboarding Guide

Welcome to the RBAC Standard Backend. This guide will get you from a fresh clone to a running, tested local environment in under 30 minutes.

---

## Step 1: Prerequisites

Ensure you have the following installed:

```bash
node --version   # Should be v20+
psql --version   # Should be v14+
redis-cli ping   # Should return PONG
```

Install Node.js from [nodejs.org](https://nodejs.org), PostgreSQL from [postgresql.org](https://www.postgresql.org), and Redis from [redis.io](https://redis.io).

---

## Step 2: Install Dependencies

```bash
npm install
```

---

## Step 3: Set Up Databases

```bash
# Create development and test databases
psql -d template1 -c "CREATE DATABASE amentorz_dev;"
psql -d template1 -c "CREATE DATABASE amentorz_test;"
```

> If your PostgreSQL username differs from your system username, use:
> `psql -U youruser -d template1 -c "CREATE DATABASE amentorz_dev;"`

---

## Step 4: Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Variable | Description | How to Generate |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://youruser@localhost:5432/amentorz_dev` |
| `JWT_SECRET` | Access token signing secret (32+ chars) | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Refresh token secret (32+ chars) | `openssl rand -hex 32` |
| `COOKIE_SECRET` | Cookie signing secret (32+ chars) | `openssl rand -hex 32` |

All other variables have safe defaults for local development.

---

## Step 5: Push Schema & Seed

```bash
# Sync Prisma schema to the database (development)
npx prisma migrate deploy

# Seed default roles and permissions
npx prisma db seed
```

---

## Step 6: Start the Development Server

```bash
npm run dev
```

The server starts at `http://localhost:3000`. Health check: `GET /api/v1/health`.

---

## Step 7: Run the Test Suite

```bash
npm run test
```

> No `.env` file is required for tests. `tests/env-setup.ts` injects all required fake values automatically. You need the `amentorz_test` database to exist (Step 3).

All 40+ tests should pass on a fresh clone.

---

## Understanding the Codebase

### Key Files

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | Single source of truth for the database schema |
| `prisma.config.ts` | Prisma CLI configuration (connection URL for migrations/seeding) |
| `src/config/index.ts` | Zod-validated environment loading — crashes on startup if misconfigured |
| `src/infrastructure/database/connection.ts` | Prisma client singleton with `pg.Pool` driver adapter |
| `src/app.ts` | Express app setup (middleware, routes, error handling) |
| `src/server.ts` | Server bootstrap (DB connect, Redis connect, HTTP listen) |
| `src/routes/index.ts` | Central router mounting all module routes |

### Module Pattern

Every feature follows this structure:

```
src/modules/[feature]/
├── [feature].controller.ts   # Thin HTTP handlers — parse request, call service, send response
├── [feature].service.ts      # Business logic — all DB operations live here
├── [feature].dto.ts          # Zod schemas for request validation and TypeScript types
└── [feature].routes.ts       # Express router with middleware guards
```

### Adding a New Module

1. Create the folder `src/modules/[feature]/` with the 4 files above.
2. Follow an existing module as a template (e.g., `src/modules/permissions/`).
3. Register the routes in `src/routes/index.ts`.
4. Create a test file at `tests/modules/[feature].test.ts`.
5. Add any new Prisma model to `prisma/schema.prisma` and create a migration with `npx prisma migrate dev --create-only` (review the SQL before applying it).

### Important Gotchas

| Gotcha | Detail |
|---|---|
| **Prisma 7 — no `url` in schema** | `DATABASE_URL` is set in `prisma.config.ts`, not `schema.prisma`. Never add `url = env("DATABASE_URL")` back. |
| **Always import `{ prisma }` from `@infrastructure/database/index`** | Never instantiate `new PrismaClient()` directly — the driver adapter won't be configured. |
| **`tests/env-setup.ts` must load before `tests/setup.ts`** | Do not reorder `setupFiles` in `vitest.config.ts`. |
| **Transaction context** | If a service function accepts `tx?: Prisma.TransactionClient`, always pass it through to child DB calls, otherwise they run outside the transaction. |

---

## Next Steps

- Read [Architecture](ARCHITECTURE.md) for the full system overview.
- Read [Security](SECURITY.md) for authentication and authorization details.
- Read [RBAC Rules](RBAC_RULES.md) for how permission checks work.
- Read [Contributing Guidelines](CONTRIBUTING.md) before your first PR.
