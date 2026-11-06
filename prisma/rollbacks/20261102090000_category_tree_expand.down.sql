-- Rolls back 20261102090000_category_tree_expand. Roll back the contract phase first.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/rollbacks/20261102090000_category_tree_expand.down.sql
--
-- Curricula and student profiles go back to their frontline tab (the depth-1 ancestor).
-- Every category the migration or an admin created afterwards is removed. Categories that
-- existed before the migration (created before it started, and not a copied SUBSECTION node)
-- are kept. The script aborts, changing nothing, if that is impossible, for example if
-- two leaves under one tab hold the same (board, subject, level) offering, or an admin
-- created a new tab with curricula. In that case restore the backup (README.md).
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'curricula_category_check') THEN
    RAISE EXCEPTION 'category_tree expand rollback: roll back 20261102100000_category_tree_contract first';
  END IF;
END $$;

CREATE TEMP TABLE "_category_tree_original" ON COMMIT DROP AS
SELECT c."id"
FROM "categories" c
WHERE c."created_at" < (SELECT "started_at" FROM "_prisma_migrations"
                        WHERE "migration_name" = '20261102090000_category_tree_expand')
  AND NOT EXISTS (SELECT 1 FROM "catalogue_nodes" n WHERE n."id" = c."id");

-- Each category's frontline tab: the ancestor at depth 1
CREATE TEMP TABLE "_category_tree_tab" ON COMMIT DROP AS
SELECT c."id" AS category_id, tab."id" AS tab_id
FROM "categories" c
JOIN "categories" tab
  ON tab."path" = split_part(c."path", '/', 1) || '/' || split_part(c."path", '/', 2)
WHERE c."depth" >= 1;

UPDATE "curricula" cu SET "category_id" = t.tab_id, "updated_at" = now()
FROM "_category_tree_tab" t WHERE t.category_id = cu."category_id" AND t.tab_id <> cu."category_id";

UPDATE "student_profiles" sp SET "category_id" = t.tab_id, "updated_at" = now()
FROM "_category_tree_tab" t WHERE t.category_id = sp."category_id" AND t.tab_id <> sp."category_id";

DROP TRIGGER "categories_tree_check" ON "categories";
DROP FUNCTION "category_tree_check"();
DROP FUNCTION "category_tree_verify"();
DROP TABLE "category_levels";

-- Drop the self FK, then delete every category that is not an original one
ALTER TABLE "categories" DROP CONSTRAINT "categories_parent_id_fkey";
DELETE FROM "categories" c WHERE c."id" NOT IN (SELECT "id" FROM "_category_tree_original");
-- A remaining FK violation (curricula, levels, catalogue_nodes on a new category) aborts here

ALTER TABLE "categories"
  DROP CONSTRAINT "categories_root_check",
  DROP CONSTRAINT "categories_not_own_parent_check",
  DROP CONSTRAINT "categories_code_format_check",
  DROP CONSTRAINT "categories_path_ends_with_code_check",
  DROP CONSTRAINT "categories_depth_check",
  DROP CONSTRAINT "categories_version_check";
DROP INDEX "categories_path_key";
DROP INDEX "categories_path_pattern_idx";
DROP INDEX "categories_inactive_path_idx";
DROP INDEX "categories_bookable_path_idx";
DROP INDEX "categories_parent_id_display_order_idx";
DROP INDEX "categories_parent_id_code_key";
CREATE UNIQUE INDEX "categories_code_key" ON "categories"("code");

ALTER TABLE "categories"
  DROP COLUMN "parent_id",
  DROP COLUMN "path",
  DROP COLUMN "depth",
  DROP COLUMN "is_bookable",
  DROP COLUMN "requires_level",
  DROP COLUMN "version";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261102090000_category_tree_expand';

COMMIT;
