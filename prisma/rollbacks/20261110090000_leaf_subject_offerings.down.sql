-- Rollback of 20261110090000_leaf_subject_offerings. Restores the schema only: the deleted
-- subjectless curricula, tutor assignments and prices are not recreated (restore a snapshot
-- for that). It re-creates one subjectless curriculum per leaf, as the earlier migration did.
BEGIN;
ALTER TABLE "curricula" ALTER COLUMN "subject_id" DROP NOT NULL;

CREATE OR REPLACE FUNCTION "category_sync_leaf"(cat UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  has_children BOOLEAN;
BEGIN
  IF cat IS NULL OR NOT EXISTS (SELECT 1 FROM "categories" WHERE "id" = cat) THEN RETURN; END IF;
  has_children := EXISTS (SELECT 1 FROM "categories" WHERE "parent_id" = cat);
  IF has_children THEN
    IF "category_in_use"(cat) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:CATEGORY_IN_USE', DETAIL = cat::text;
    END IF;
    DELETE FROM "curricula" WHERE "category_id" = cat;
    DELETE FROM "category_levels" WHERE "category_id" = cat;
    UPDATE "categories" SET "is_bookable" = false, "requires_board" = false, "requires_level" = false
    WHERE "id" = cat AND ("is_bookable" OR "requires_board" OR "requires_level");
  ELSE
    UPDATE "categories" SET "is_bookable" = true, "requires_board" = false, "requires_level" = false
    WHERE "id" = cat AND (NOT "is_bookable" OR "requires_board" OR "requires_level");
    INSERT INTO "curricula" ("category_id", "updated_at")
    SELECT cat, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM "curricula"
      WHERE "category_id" = cat AND "subject_id" IS NULL AND "board_id" IS NULL AND "level_id" IS NULL);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "category_before_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "curricula"
  WHERE "category_id" = OLD."id" AND "subject_id" IS NULL AND "board_id" IS NULL AND "level_id" IS NULL;
  RETURN OLD;
END $$;

CREATE TRIGGER "categories_before_delete"
  BEFORE DELETE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION "category_before_delete"();

INSERT INTO "curricula" ("category_id", "updated_at")
SELECT c."id", now() FROM "categories" c
WHERE c."is_bookable" AND NOT EXISTS (
  SELECT 1 FROM "curricula" cu
  WHERE cu."category_id" = c."id" AND cu."subject_id" IS NULL AND cu."board_id" IS NULL AND cu."level_id" IS NULL);

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261110090000_leaf_subject_offerings';
COMMIT;
