# Category tree migration runbook (ADR-0005)

Two migrations, shipped as separate commits so the contract phase can wait for staging
sign-off:

| Migration | What it does | Rollback script |
|---|---|---|
| `20261102090000_category_tree_expand` | Adds the tree columns and `category_levels`, backfills, adds the tree trigger and verifies. Aborts on any failed check. | `20261102090000_category_tree_expand.down.sql` |
| `20261102100000_category_tree_contract` | Re-verifies, makes `curricula.level_id` nullable, and adds the level FK and the reference triggers. | `20261102100000_category_tree_contract.down.sql` |

Each migration and each rollback is one transaction: it either applies completely or
changes nothing.

## 1. Back up (every shared environment)

```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > amentorz-$(date +%Y%m%d-%H%M)-pre-category-tree.dump
pg_restore --list amentorz-*-pre-category-tree.dump > /dev/null   # the dump is readable
```

Store the dump with the release notes. The backup is the fallback when a rollback script
refuses to run.

## 2. Dry run on a copy of production data

```bash
createdb amentorz_dryrun
pg_restore --no-owner -d amentorz_dryrun amentorz-…-pre-category-tree.dump
DATABASE_URL=postgresql://…/amentorz_dryrun npx prisma migrate deploy
psql postgresql://…/amentorz_dryrun -c "SELECT * FROM category_tree_verify()"   # every failures = 0
psql postgresql://…/amentorz_dryrun -c "SELECT path, is_bookable, is_active FROM categories ORDER BY path"
```

If the expand migration aborts, its message names the failed checks (for example
`profiles_not_on_bookable_leaf=3`). Fix the data on production first, for example by
giving those students a subject, then dry-run again.

## 3. Verify (staging, before the contract phase)

- `SELECT * FROM category_tree_verify()` returns 0 failures for every check: roots,
  path and depth, no cycles or orphans, unique paths, bookable nodes without children,
  curricula and profiles on bookable leaves, and the level and board rules.
- The row counts match. The migration checks this itself: curricula and student
  profiles are unchanged, and categories = old + 2 roots + sub-sections + `general`
  leaves.
- Switch on the learner read path (`catalogue.category_tree` feature flag) in staging and
  compare it with the old catalogue screens.

## 4. Roll back

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollbacks/20261102100000_category_tree_contract.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollbacks/20261102090000_category_tree_expand.down.sql
```

Then deploy the previous application version. The expand rollback moves curricula and
profiles back to their tab and removes every category created since the migration. It
refuses to run when that would lose data. Two cases cause this: two leaves under one tab
offer the same (board, subject, level), or an admin created a new tab that has
curricula. In that case restore the backup from step 1.

`tests/modules/category-tree-migration.test.ts` runs the whole sequence on the legacy
fixture in `tests/fixtures/category-tree-legacy.sql`, and checks that the rollback
restores the exact schema and data.

## Applying without the Prisma CLI

These are plain SQL files with their own `BEGIN`/`COMMIT`. `prisma migrate deploy` is
the normal path. Review any `prisma migrate dev --create-only` output: it must not drop
the hand-written indexes, CHECK constraints or triggers (`findings.md`).
