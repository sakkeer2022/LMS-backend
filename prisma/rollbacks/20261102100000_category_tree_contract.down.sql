-- Rolls back 20261102100000_category_tree_contract. Run with:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollbacks/20261102100000_category_tree_contract.down.sql
-- Aborts (changing nothing) if a curriculum already has no level.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "curricula" WHERE "level_id" IS NULL) THEN
    RAISE EXCEPTION 'category_tree contract rollback: % curricula have no level; give them one or delete them first',
      (SELECT count(*) FROM "curricula" WHERE "level_id" IS NULL);
  END IF;
END $$;

DROP TRIGGER IF EXISTS "categories_reference_check" ON "categories";
DROP TRIGGER IF EXISTS "curricula_category_check" ON "curricula";
DROP TRIGGER IF EXISTS "student_profiles_category_check" ON "student_profiles";
DROP FUNCTION IF EXISTS "category_referenced_flags_check"();
DROP FUNCTION IF EXISTS "category_reference_check"();
ALTER TABLE "curricula" DROP CONSTRAINT IF EXISTS "curricula_category_id_level_id_fkey";
ALTER TABLE "curricula" ALTER COLUMN "level_id" SET NOT NULL;

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261102100000_category_tree_contract';

COMMIT;
