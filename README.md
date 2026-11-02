# Amentorz Platform Backend Service

Production-grade Node.js / Express backend service powering the **Amentorz Tuition Learning Management Platform**.

---

## 1. Prerequisites

Ensure the following runtimes and services are installed and running locally:

- **Node.js:** v20+ LTS (Node.js 20.x or 22.x)
- **PostgreSQL:** v16+ (running on port 5432)
- **Redis:** v7+ (running on port 6379, used for rate limiting and token caching)

---

## 2. Project Setup

### A. Clone & Configure Environment Variables

Copy `.env` **before** installing: `npm ci` runs `prisma generate`, which fails with `Cannot resolve environment variable: DATABASE_URL` when there is no `.env`.

```bash
# Clone the repository and enter the backend directory
git clone https://bitbucket.org/evalogical-repo/amentorz-backend.git
cd amentorz-backend

# Copy the environment template
cp .env.example .env
```

Open `.env` and verify the configuration:

- `PORT=3000` — Backend HTTP port
- `API_PREFIX=/api/v1` — Base path for all business routes
- `DATABASE_URL` — Connection string for local development:
`postgresql://postgres:password@localhost:5432/amentorz_dev?schema=public`
- `TEST_DATABASE_URL` — Dedicated, disposable test database:
`postgresql://postgres:password@localhost:5432/amentorz_test?schema=public`
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET` — Replace with 32+ character secrets (generate via `openssl rand -hex 32`)
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` — Payment gateway credentials (`rzp_test_*` for local development). Razorpay is the leading candidate; the final gateway is still to be confirmed (`docs/PENDING_DECISIONS.md`)
- `METRICS_TOKEN` — Bearer token for `GET /metrics`; optional locally, **required (32+ characters) in production**
- `ALLOWED_ORIGINS` — Comma-separated browser origins allowed to call the API with cookies; empty locally allows the admin, student and faculty dev servers (`http://localhost:3001`, `3002`, `3003`), **required in production**

### B. Install Dependencies

```bash
# Install the exact locked dependencies, generate the Prisma Client and install the git hooks
npm ci
```

> **Test Environment Note:** Automated tests run with `NODE_ENV=test` and inject deterministic secrets via `tests/env-setup.ts`.

---

## 3. Database Setup & Migration Safety

### A. Create Local Databases

Create separate databases for local development and automated testing:

```bash
# Create local development and test databases
psql -h localhost -U postgres -c "CREATE DATABASE amentorz_dev;"
psql -h localhost -U postgres -c "CREATE DATABASE amentorz_test;"
```

### B. Apply Migrations & Seed Data

```bash
# Apply versioned migrations to local development
npx prisma migrate dev

# In CI or Test environments, deploy existing migration history
npx prisma migrate deploy

# Seed baseline system roles, permissions, and initial reference catalogue
npx prisma db seed
```

> ⚠️ **CRITICAL DATABASE SAFETY INVARIANT:** Destructive commands such as `prisma migrate reset` and `prisma db push` are strictly prohibited. Test suites are protected by an automated WHATWG URL validator (`assertTestDatabaseUrl`) that rejects execution if the parsed database name is not strictly `amentorz_test` on an approved local host.

---

## 4. Run the Backend

```bash
# Start the development server with live reload (tsx watch)
npm run dev
```

- **Base URL:** `http://localhost:3000/api/v1`
- **Health Check:** `http://localhost:3000/health` (returns HTTP 200 with status `ok`)
- **Prometheus Metrics:** `http://localhost:3000/metrics`

To run the production build:

```bash
npm run build
npm start
```

---

## 5. Swagger UI & OpenAPI Specification

Two OpenAPI 3.0.3 documents are served in development and test (both are disabled in production):

| Document | Swagger UI | Raw JSON | Source |
|---|---|---|---|
| **Implemented API**: routes this server actually exposes | [`/api/docs`](http://localhost:3000/api/docs) | [`/api/docs/spec`](http://localhost:3000/api/docs/spec) | `@openapi` JSDoc in `src/modules/**/*.routes.ts` + `swagger/components.yaml` |
| **Draft Sprint 1 contract**: proposed API under review, not implemented | [`/api/docs/contract`](http://localhost:3000/api/docs/contract) | [`/api/docs/contract/spec`](http://localhost:3000/api/docs/contract/spec) | [`docs/openapi.yaml`](docs/openapi.yaml) |

- **Contract Validation:** Validate `docs/openapi.yaml` against structural standards and internal references:
  ```bash
  npm run contract:validate
  ```
- **Documenting New APIs:** Implement endpoints against the approved contract in `docs/openapi.yaml`, and document each implemented route with an `@openapi` JSDoc block in its `.routes.ts` file so it appears in the implemented spec.

---

## 6. Testing

The repository uses **Vitest** and **Supertest** with full separation between fast unit tests and isolated database integration tests.

```bash
# Run unit tests only (fast, in-memory, no database required)
npm run test:unit

# Apply migrations to the test database first. The Prisma CLI reads DATABASE_URL
# (from .env by default), so point it at amentorz_test explicitly:
DATABASE_URL="postgresql://postgres:password@localhost:5432/amentorz_test?schema=public" npx prisma migrate deploy

# Run integration tests (exercises Express routes and Prisma against amentorz_test)
npm run test:integration

# Run the complete test suite
npm test

# Generate code coverage report
npm run test:coverage
```

### Test Isolation Principles

1. **Target Lock:** Automated tests are locked to `amentorz_test` and will immediately abort if pointed to `amentorz_dev`, `postgres`, or client databases.
2. **Migration Check:** Integration runs abort if any migration in `prisma/migrations` has not been applied to `amentorz_test`.
3. **Table Truncation:** Before each test, every migrated table is cleaned with a single `TRUNCATE ... CASCADE` without dropping the schema. Truncate failures fail the run.

> `docker-compose.yml` creates `amentorz_test` only when its Postgres volume is first initialised. On an existing volume, create it manually with `psql`; do not remove the volume.

---

## 7. Quality & Security Checks

Run these checks prior to opening pull requests:

```bash
# Type check without emitting JavaScript
npm run typecheck

# Check and auto-fix linting issues
npm run lint
npm run lint:fix

# Format code with Prettier
npm run format
npm run format:check

# Compile production bundle and resolve runtime path aliases
npm run build

# Run npm dependency security audit
npm run audit

# Run combined security checks (Audit + ESLint Security Rules)
npm run security:check
```

---

## 8. Troubleshooting & FAQ

- **`Database Safety Guard: Unapproved test database`**  
Ensure your `TEST_DATABASE_URL` points to `amentorz_test` on `localhost` or `127.0.0.1`. The test guard intentionally prevents tests from targeting development or production databases.
- **`Redis ECONNREFUSED on 127.0.0.1:6379` during tests**  
Redis is optional for unit and integration testing. When Redis is unavailable, rate limiting and session stores automatically fall back to fast in-memory equivalents.
- **OpenAPI Reference Validation Errors**  
Run `npm run contract:validate` to pinpoint any broken internal `$ref` pointers or missing required schema properties.
- **Build Alias Resolution**  
TypeScript path aliases (`@core/*`, `@modules/*`, etc.) are resolved during build time by `scripts/resolve-build-aliases.cjs`. Always run `npm run build` before running `npm start`.

---

## 9. Architecture & Supporting Documentation

For architectural deep-dives and schema specifications:

- [`docs/database/schema-api-contract-verification.md`](docs/database/schema-api-contract-verification.md) — 76-operation schema-to-contract traceability matrix.
- [`docs/database/schema-data-dictionary.md`](docs/database/schema-data-dictionary.md) — Granular field-level database reference.
- [`docs/database/schema-review-summary.md`](docs/database/schema-review-summary.md) — Executive briefing and Gate 4 sign-off.
- [`docs/database/amentorz-domain-overview.md`](docs/database/amentorz-domain-overview.md) — High-level domain architecture and roadmap boundaries.
- [`src/docs/ARCHITECTURE.md`](src/docs/ARCHITECTURE.md) — Modular monolith architectural overview.
- [`src/docs/SECURITY.md`](src/docs/SECURITY.md) — Security policies, token rotation, and data protection.

