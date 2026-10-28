# ADR-0002: Migration from MySQL + Sequelize to PostgreSQL + Prisma

**Status:** Accepted  
**Date:** 2026-07-07  
**Deciders:** Project Lead

---

## Context

The original bootstrap was built with MySQL v8 and Sequelize ORM. While functional, this combination created friction in three areas:

1. **Type safety**: Sequelize's TypeScript support is weak — types for models, queries, and transactions require significant boilerplate and manual maintenance.
2. **DX overhead**: Running migrations with Sequelize CLI requires additional configuration files (`.sequelizerc`, separate migration JS files) and manual model-to-table mapping.
3. **Modern ecosystem**: The Node.js/TypeScript ecosystem has largely shifted toward Prisma for new projects due to its code-generated client, schema-first approach, and superior developer tooling.

---

## Decision

Migrate the entire database layer from:
- **MySQL** → **PostgreSQL (v14+)**
- **Sequelize ORM** → **Prisma ORM (v7)**

---

## Consequences

### Positive

- **Full type safety**: Prisma auto-generates a typed client from the schema. No more casting, no more `any` types in query results.
- **Single source of truth**: `prisma/schema.prisma` defines the data model, generates the client, and drives migrations — all from one file.
- **Better transactions**: `prisma.$transaction(async (tx) => { ... })` is cleaner and easier to type correctly than Sequelize's transaction callback.
- **Superior JSON support**: PostgreSQL's native `JSONB` column type (`conditions` in `feature_flags`) outperforms MySQL's JSON implementation.
- **Prisma Studio**: Free GUI for inspecting data locally (`npx prisma studio`).

### Negative / Trade-offs

- **Prisma v7 breaking change**: The `url` property is no longer allowed in `schema.prisma`'s `datasource` block. A `prisma.config.ts` file is now required, and the app must use a driver adapter (`@prisma/adapter-pg`).
- **Driver adapter required**: Adding `@prisma/adapter-pg` and `pg` as runtime dependencies is mandatory.
- **No automatic relation loading**: Unlike Sequelize's `include` with eager loading shortcuts, Prisma requires explicit `include` blocks in every query. This is more verbose but far more explicit and predictable.

---

## Alternatives Considered

| Alternative | Reason Rejected |
|---|---|
| Stay with MySQL + Sequelize | Type safety issues; Sequelize's TS support is difficult to maintain |
| MySQL + Prisma | PostgreSQL has better JSON support and stricter SQL compliance |
| PostgreSQL + TypeORM | TypeORM has similar DX issues to Sequelize with decorators; Prisma's schema-first approach is preferred |
| PostgreSQL + Drizzle | Drizzle is excellent but newer; Prisma has broader adoption and better documentation for this use case |

---

## Implementation Notes

- All Sequelize migration files (`migrations/`) and seeders (`seeders/`) have been deleted.
- The new seed script lives at `prisma/seed.ts` and is configured in `prisma.config.ts`.
- The `DATABASE_URL` env var replaces the old `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` vars.
- See [findings.md](../../findings.md) for all issues encountered and their resolutions.
