-- Rollback of 20261105090000_category_simple_leaves. Refuses (and changes nothing) when a
-- category curriculum is already used by a tutor, price, learner or library material.
BEGIN;
DROP TRIGGER IF EXISTS "categories_leaf_sync" ON "categories";
DROP TRIGGER IF EXISTS "categories_before_delete" ON "categories";
DROP FUNCTION IF EXISTS "category_leaf_sync"();
DROP FUNCTION IF EXISTS "category_before_delete"();
DROP FUNCTION IF EXISTS "category_sync_leaf"(UUID);
DROP FUNCTION IF EXISTS "category_in_use"(UUID);
DELETE FROM "curricula" WHERE "subject_id" IS NULL;
ALTER TABLE "curricula" ALTER COLUMN "subject_id" SET NOT NULL;
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261105090000_category_simple_leaves';
COMMIT;
