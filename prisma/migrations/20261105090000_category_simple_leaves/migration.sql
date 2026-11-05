-- Simple category tree (replaces the admin's "bookable" and "allowed levels" settings).
-- The admin now manages only names, order, active state and the tree shape. Every
-- category without sub-categories is a leaf that tutors and learners choose directly:
--   * categories.is_bookable is derived: true exactly when the category has no children;
--     requires_board / requires_level are always false.
--   * Each leaf owns one curriculum with no subject, board or level (its "category
--     curriculum"). Faculty assignments, prices and consent keep pointing at curricula.
-- Triggers keep this true for every write path (create, move, delete, seed).
-- Existing subject/board/level curricula are kept, so current assignments and prices
-- still resolve; new choices use the category curriculum.
-- Rollback: prisma/rollbacks/20261105090000_category_simple_leaves.down.sql
BEGIN;

-- A category curriculum has no subject
ALTER TABLE "curricula" ALTER COLUMN "subject_id" DROP NOT NULL;

-- Something already depends on the category: a learner profile, or one of its
-- curricula has a tutor, a price, a learner subject or a library material.
CREATE OR REPLACE FUNCTION "category_in_use"(cat UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM "student_profiles" sp WHERE sp."category_id" = cat)
      OR EXISTS (
        SELECT 1 FROM "curricula" cu
        WHERE cu."category_id" = cat AND (
             EXISTS (SELECT 1 FROM "faculty_assignments" fa WHERE fa."curriculum_id" = cu."id")
          OR EXISTS (SELECT 1 FROM "price_rules" pr WHERE pr."curriculum_id" = cu."id")
          OR EXISTS (SELECT 1 FROM "student_subjects" ss WHERE ss."curriculum_id" = cu."id")
          OR EXISTS (SELECT 1 FROM "library_materials" lm WHERE lm."curriculum_id" = cu."id")))
$$;

-- Makes one category's leaf state match its children.
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

CREATE OR REPLACE FUNCTION "category_leaf_sync"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM "category_sync_leaf"(NEW."parent_id");
    PERFORM "category_sync_leaf"(NEW."id");
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW."parent_id" IS DISTINCT FROM OLD."parent_id" THEN
      PERFORM "category_sync_leaf"(OLD."parent_id");
      PERFORM "category_sync_leaf"(NEW."parent_id");
    END IF;
  ELSE
    PERFORM "category_sync_leaf"(OLD."parent_id");
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "categories_leaf_sync"
  AFTER INSERT OR UPDATE OF "parent_id" OR DELETE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION "category_leaf_sync"();

-- A deleted leaf takes its category curriculum with it. A curriculum that something
-- still uses is protected by its foreign keys, so the delete fails instead.
CREATE OR REPLACE FUNCTION "category_before_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "curricula"
  WHERE "category_id" = OLD."id" AND "subject_id" IS NULL AND "board_id" IS NULL AND "level_id" IS NULL;
  RETURN OLD;
END $$;

CREATE TRIGGER "categories_before_delete"
  BEFORE DELETE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION "category_before_delete"();

-- Backfill: every category without children becomes a leaf with a category curriculum
UPDATE "categories" c
SET "is_bookable" = NOT EXISTS (SELECT 1 FROM "categories" ch WHERE ch."parent_id" = c."id"),
    "requires_board" = false,
    "requires_level" = false;

INSERT INTO "curricula" ("category_id", "updated_at")
SELECT c."id", now()
FROM "categories" c
WHERE c."is_bookable"
  AND NOT EXISTS (
    SELECT 1 FROM "curricula" cu
    WHERE cu."category_id" = c."id" AND cu."subject_id" IS NULL AND cu."board_id" IS NULL AND cu."level_id" IS NULL);

DO $$
DECLARE failed TEXT;
BEGIN
  SELECT string_agg("check_name" || '=' || "failures", ', ') INTO failed
  FROM "category_tree_verify"() WHERE "failures" > 0;
  IF failed IS NOT NULL THEN
    RAISE EXCEPTION 'category simple leaves: verification failed: %', failed;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "categories" c
    WHERE c."is_bookable" AND NOT EXISTS (
      SELECT 1 FROM "curricula" cu
      WHERE cu."category_id" = c."id" AND cu."subject_id" IS NULL AND cu."board_id" IS NULL AND cu."level_id" IS NULL)) THEN
    RAISE EXCEPTION 'category simple leaves: a leaf has no category curriculum';
  END IF;
END $$;

COMMIT;
