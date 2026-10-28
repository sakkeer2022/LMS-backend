# Contributing Guidelines

## Engineering Rigor

We value maintainability, predictability, and stability over speed. Do not skip engineering rigor to deliver features faster.

## Pre-Requisites

- Node.js (v20+ LTS)
- PostgreSQL (v14+)
- Redis (v7+)
- TypeScript knowledge
- Familiarity with Prisma ORM

## Local Setup

1. Clone the repository.
2. Run `npm install` in the `backend/` directory. For CI or production deployments, use `npm ci` to respect the exact `package-lock.json` versions.
3. We strictly track `package-lock.json` in version control to ensure reproducible builds. If you add or update dependencies, commit the updated `package-lock.json`.
4. Create your local databases:
   ```bash
   psql -d template1 -c "CREATE DATABASE amentorz_dev;"
   psql -d template1 -c "CREATE DATABASE amentorz_test;"
   ```
5. Copy `.env.example` to `.env` and configure your local environment:
   ```bash
   cp .env.example .env
   ```
   - **`.env` is git-ignored** and must never be committed. It is for local runtime only.
   - **Secrets that must be replaced** before starting the server: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`. Use `openssl rand -hex 32` to generate each independently.
   - **`DATABASE_URL`** must point to your local PostgreSQL instance (e.g., `postgresql://youruser@localhost:5432/amentorz_dev`).
   - **Safe defaults** — all other variables have sensible defaults that work for local development.
   - **`npm run test` does not need a `.env` file.** The test runner (`tests/env-setup.ts`) injects fake deterministic values before any app code is imported. Never rely on your private `.env` to make tests pass.
   - **Production only:** `ALLOWED_ORIGINS` must be set to a comma-separated list of permitted client origins in production. It is ignored in development and test.

6. Push the Prisma schema and seed:
   ```bash
   npx prisma migrate deploy
   npx prisma db seed
   ```

## Code Standards

- **TypeScript Strict Mode**: Enabled everywhere. Absolutely no `any` types. Use `unknown` with runtime type narrowing if dynamic data is unavoidable.
- **Formatters & Linters**: `ESLint` and `Prettier` are strictly enforced.
- **Git Hooks**: `Husky` and `lint-staged` are configured to format and lint code prior to allowing a commit.

## Architectural Guidelines

1. **No Business Logic in Controllers**: Controllers must be thin, delegating all operations to the Service layer.
2. **DTOs Everywhere**: Requests must be validated and transformed into Data Transfer Objects using Zod before reaching the Service layer.
3. **Schema Changes via Prisma**: Database schema changes must be done via `prisma migrate dev` to generate versioned migration files. Manual DB tweaking is strictly forbidden.
4. **Prisma Client**: Always import `{ prisma }` from `@infrastructure/database/index`. Never instantiate `new PrismaClient()` directly outside of `connection.ts`.
5. **Transactions**: Wrap multi-table mutations in `prisma.$transaction(async (tx) => { ... })` and pass `tx` to sub-operations.
6. **Seeding**: Default roles, permissions, and system entities belong in `prisma/seed.ts`.

## Pull Request Process

1. Use feature branches (`feature/branch-name`, `bugfix/branch-name`).
2. Write unit and integration tests for your new code.
3. Update documentation if necessary.
4. Ensure CI/CD passes successfully.
5. Request review from a code owner.

## Branch Protection & CI Pipeline

- **No Direct Pushes**: Direct pushes to the `main` branch are restricted. All code changes must go through a Pull Request.
- **Status Checks**: All GitHub Actions CI checks (linting, TypeScript build, testing, and security audit) must pass before a branch can be merged into `main`.
- **Commit Standards**: We enforce Conventional Commits. Commits must follow this format (e.g., `feat: added authentication`). Non-compliant commits will be blocked by our `commit-msg` hook.
- **Pre-Push Checks**: Fast, deterministic checks (lint, build, and unit tests) are configured to run automatically before any push via a `pre-push` Husky hook. Full integration tests are deferred to the CI pipeline. Ensure these local checks pass before pushing.
