# Implementation Phases

This document details the rigorous engineering steps for building the RBAC platform. Each phase includes structural patterns, code examples, testing requirements, and architectural reasoning.

---

## Phase 1: Project Setup and Standards ✅ Complete

### Folder Structure

```
backend/
├── src/
│   ├── config/index.ts         # Zod env validation
│   ├── core/logger/            # Pino structured logger
│   ├── core/errors/            # Custom error classes
│   ├── core/security/jwt.ts    # Token signing/verification
│   └── server.ts               # Express app bootstrap
├── prisma/
│   ├── schema.prisma           # Data model
│   ├── seed.ts                 # Default roles & permissions
│   └── prisma.config.ts        # Prisma 7 connection config
├── tsconfig.json
└── package.json
```

### Key Patterns

**Environment Validation:** Zod validates all `process.env` values on startup. The app throws immediately if any required variable is missing or malformed.

```typescript
// src/config/index.ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
});
export const config = envSchema.parse(process.env);
```

**Prisma 7 Driver Adapter:** The `DATABASE_URL` is no longer set inside `schema.prisma`. Instead, use `prisma.config.ts` for CLI tooling and a `pg.Pool` adapter for the runtime client.

```typescript
// src/infrastructure/database/connection.ts
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
const pool = new pg.Pool({ connectionString: config.databaseUrl });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });
```

---

## Phase 2: Authentication System ✅ Complete

### Module Structure

```
src/modules/auth/
├── auth.controller.ts   # Thin HTTP handlers
├── auth.service.ts      # Business logic
├── auth.dto.ts          # Zod schemas
└── auth.routes.ts       # Route registration
```

### Key Patterns

**JWT Access + Opaque Refresh Token:** Refresh tokens are hashed and stored in the `refresh_tokens` table for revocation support.

**Transaction-safe registration:** User creation and initial role assignment are wrapped in `prisma.$transaction`.

```typescript
// auth.service.ts
const result = await prisma.$transaction(async (tx) => {
  const user = await tx.user.create({ data: { ... } });
  await tx.userRole.create({ data: { userId: user.id, roleId: viewerRole.id } });
  return user;
});
```

---

## Phase 3: RBAC Schema and Backend ✅ Complete

### Implemented Tables

- `roles` — named roles (e.g. super_admin, admin, viewer)
- `permissions` — named permissions (e.g. `users:create`, `roles:read`)
- `user_roles` — many-to-many join between users and roles
- `role_permissions` — many-to-many join between roles and permissions

### Key Pattern: Idempotent Assignment

```typescript
// Assign role without duplicates
await prisma.userRole.upsert({
  where: { userId_roleId: { userId, roleId } },
  update: {},
  create: { userId, roleId },
});
```

---

## Phase 4: Permission Middleware ✅ Complete

The `hasPermission(action, resource)` middleware evaluates the authenticated user's full permission set (cached in the JWT payload) against the required permission for the route.

---

## Phase 5: Audit Logging ✅ Complete

Every sensitive API action is recorded in `audit_logs`. The Pino logger and audit middleware cooperate to produce both structured JSON logs and persistent DB records.

---

## Phase 6: Feature Flags ✅ Complete

A full feature flag management API with rollout percentages, condition targeting, and enable/disable toggling. Protected by RBAC with the `feature_flags:*` permission set.

---

## Future Phases

### Phase 7: AI Workflow Layer (Planned)

- AI agent identity files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`)
- Module scaffold generator (`npm run scaffold:module`)
- AI-gated CI checks (PR review, coverage enforcement)
- Machine-readable context file for AI agent consumption

### Phase 8: Organization Hierarchies (Planned)

- Tenant/organisation support
- Hierarchical RBAC with role inheritance

### Phase 9: External IAM Integrations (Planned)

- OAuth 2.0 (Google, GitHub)
- SAML / OIDC enterprise SSO
- Pluggable Auth Strategy pattern
