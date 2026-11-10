-- A leaf's offerings are its subjects (leaf + subject), chosen by tutors, priced by the
-- admin and picked by students. Replaces the subjectless "category curriculum" that
-- 20261105090000_category_simple_leaves created for every leaf.
--   * category_sync_leaf keeps deriving the leaf flags and the in-use guard, but no longer
--     creates or (for a leaf that gets children) keeps a subjectless curriculum.
--   * categories_before_delete is dropped: it only removed that subjectless curriculum.
--     A category that still has curricula stays protected by curricula.category_id (RESTRICT).
--   * Data reset: the subjectless curricula, and the tutor assignments and prices that
--     pointed at them, are deleted. Consent rows are kept (append-only history); a stale
--     price snapshot hash simply no longer matches, so tutors consent again.
--   * curricula.subject_id is NOT NULL again.
-- Rollback: prisma/rollbacks/20261110090000_leaf_subject_offerings.down.sql (schema only;
-- the deleted rows are not restored, so take a snapshot first).
BEGIN;

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
  END IF;
END $$;

DROP TRIGGER IF EXISTS "categories_before_delete" ON "categories";
DROP FUNCTION IF EXISTS "category_before_delete"();

-- Data reset: everything that pointed at a subjectless curriculum
CREATE TEMP TABLE "subjectless" ON COMMIT DROP AS
  SELECT "id" FROM "curricula" WHERE "subject_id" IS NULL;
DELETE FROM "price_rules" WHERE "curriculum_id" IN (SELECT "id" FROM "subjectless");
DELETE FROM "faculty_assignments" WHERE "curriculum_id" IN (SELECT "id" FROM "subjectless");
DELETE FROM "student_subjects" WHERE "curriculum_id" IN (SELECT "id" FROM "subjectless");
DELETE FROM "curricula" WHERE "id" IN (SELECT "id" FROM "subjectless");

ALTER TABLE "curricula" ALTER COLUMN "subject_id" SET NOT NULL;

DO $$
DECLARE failed TEXT;
BEGIN
  SELECT string_agg("check_name" || '=' || "failures", ', ') INTO failed
  FROM "category_tree_verify"() WHERE "failures" > 0;
  IF failed IS NOT NULL THEN
    RAISE EXCEPTION 'leaf subject offerings: verification failed: %', failed;
  END IF;
END $$;

COMMIT;
