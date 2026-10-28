# Machine-Readable Project Context
## RBAC Standard Backend

> This file is for AI agent consumption. It provides a dense, structured snapshot of the project so an agent can understand the codebase quickly without reading every source file.

---

## Identity

```yaml
project: rbac-standard-backend
type: modular-monolith API server
language: TypeScript (strict mode)
runtime: Node.js v20+
framework: Express.js
port: 3000 (configurable via PORT env var)
api_prefix: /api/v1
```

## Tech Stack

```yaml
database: PostgreSQL 15+
orm: Prisma v7
orm_adapter: "@prisma/adapter-pg" with pg.Pool
cache: Redis 7+ via ioredis
auth: JWT (access token) + opaque refresh token
token_store: PostgreSQL (refresh_tokens table)
token_blacklist: Redis (for logged-out access tokens)
validation: Zod
logging: Pino (structured JSON)
testing: Vitest + Supertest
linting: ESLint + Prettier
```

## Key Files

```
prisma/schema.prisma          # Data model — source of truth for all DB tables
prisma.config.ts              # Prisma CLI config (connection URL, seed command)
prisma/seed.ts                # Seeds roles, permissions, and default data
src/config/index.ts           # Zod-validated env loading — crashes on startup if misconfigured
src/app.ts                    # Express app (middleware, routes, error handler)
src/server.ts                 # HTTP server bootstrap (DB + Redis connect, listen)
src/routes/index.ts           # Central router that mounts all module routes
src/infrastructure/database/connection.ts  # Prisma singleton with pg.Pool driver adapter
src/infrastructure/redis/connection.ts     # Redis client singleton
src/core/errors/index.ts      # Custom error classes (NotFoundError, ConflictError, etc.)
src/core/security/jwt.ts      # Token sign/verify utilities
src/middleware/auth.ts         # JWT authentication middleware
src/middleware/rbac.ts         # requirePermission() RBAC middleware
src/middleware/audit.ts        # Request audit logging middleware
tests/env-setup.ts            # Injects fake env vars for tests (runs FIRST)
tests/setup.ts                # Connects DB, TRUNCATE between tests (runs SECOND)
```

## Database Models

```
User            id, email, passwordHash, firstName, lastName, isActive, deletedAt
Role            id, name, description
Permission      id, name (format: "resource:action"), description
UserRole        userId, roleId (many-to-many join)
RolePermission  roleId, permissionId (many-to-many join)
RefreshToken    id, userId, tokenHash, expiresAt
AuditLog        id, actorId, action, resource, status, changes(JSON), ipAddress
FeatureFlag     id, name, description, isEnabled, rolloutPercentage, conditions(JSON), createdBy
```

## API Modules

```
/api/v1/auth              → auth module (register, login, refresh, logout, /me, csrf-token)
/api/v1/users             → users module (CRUD, assign/revoke roles, soft-delete)
/api/v1/roles             → roles module (CRUD, assign/revoke permissions)
/api/v1/permissions       → permissions module (CRUD)
/api/v1/audit             → audit module (read-only list with filters)
/api/v1/feature-flags     → feature flags module (CRUD, enable/disable)
/api/v1/health            → health check (no auth required)
```

## RBAC Permission Format

Permissions follow the pattern `resource:action`. Examples:
```
users:create    users:read    users:update    users:delete
roles:create    roles:read    roles:update    roles:delete
permissions:create  permissions:read  permissions:update  permissions:delete
audit:read
feature_flags:create  feature_flags:read  feature_flags:update  feature_flags:delete
```

## Response Contract

```typescript
// All success responses
{ success: true, message: string, data: T, meta?: PaginationMeta }

// All error responses
{ success: false, message: string, errors?: Record<string, string[]> }

// Pagination meta
{ total: number, page: number, limit: number, totalPages: number }
```

## Path Aliases (tsconfig.json)

```
@config/*        → src/config/*
@core/*          → src/core/*
@infrastructure/* → src/infrastructure/*
@middleware/*    → src/middleware/*
@modules/*       → src/modules/*
@shared/*        → src/shared/*
```

## Testing Context

```yaml
test_runner: Vitest
test_db: amentorz_test (PostgreSQL — must exist before running tests)
test_isolation: TRUNCATE ... CASCADE on all tables before each describe block
setup_files_order:
  - tests/env-setup.ts   # sets env vars (MUST BE FIRST)
  - tests/setup.ts       # connects DB, registers lifecycle hooks
unit_test_dir: tests/unit/
integration_test_dir: tests/modules/
```

## Known Gotchas

1. **Prisma 7 - No `url` in schema.prisma**: The `url = env("DATABASE_URL")` line must NOT be in the `datasource db {}` block. Configure it in `prisma.config.ts` instead.
2. **Driver adapter mandatory**: Always use `import { prisma } from '@infrastructure/database/index'`. Never do `new PrismaClient()` elsewhere.
3. **Test setup order is critical**: `env-setup.ts` MUST load before `setup.ts`. Never reorder `setupFiles` in `vitest.config.ts`.
4. **Transaction typing**: Type `tx` parameters as `Prisma.TransactionClient`, not `any`.
5. **Soft delete pattern**: Users use soft delete (`deletedAt` timestamp). Always filter with `where: { deletedAt: null }` for active users.
6. **No raw SQL**: Never use `prisma.$queryRaw` unless there is a documented performance reason.
7. **Hand-edited migration index**: `curricula_category_id_board_id_subject_id_level_id_key` uses `NULLS NOT DISTINCT` (PostgreSQL 15+), which `schema.prisma` cannot express. Any new `prisma migrate dev --create-only` output that drops or recreates this index must be removed before applying; `tests/modules/domain_schema.test.ts` guards the behaviour.

## Current Status

- All 6 modules implemented and tested
- 40 integration tests passing
- 0 ESLint errors or warnings
- PostgreSQL + Prisma migration complete
- AI workflow layer in progress
