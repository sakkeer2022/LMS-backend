-- A leaf may not need a level (requires_level = false, ADR-0005), so a student who picks one
-- has no level. curricula.level_id was already made nullable in category_tree_contract.
-- The deferred trigger student_profiles_category_check still requires a level whenever the
-- leaf's requires_level is true.
BEGIN;

ALTER TABLE "student_profiles" ALTER COLUMN "level_id" DROP NOT NULL;

-- The other direction: a leaf may not start requiring a level while a profile on it has none.
CREATE OR REPLACE FUNCTION "category_referenced_flags_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "categories"%ROWTYPE;
BEGIN
  SELECT * INTO r FROM "categories" WHERE "id" = NEW."id";
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT r."is_bookable" AND (
       EXISTS (SELECT 1 FROM "curricula" WHERE "category_id" = r."id")
    OR EXISTS (SELECT 1 FROM "student_profiles" WHERE "category_id" = r."id")) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:CATEGORY_REFERENCED', DETAIL = r."id"::text;
  END IF;
  IF r."requires_board" AND (
       EXISTS (SELECT 1 FROM "curricula" WHERE "category_id" = r."id" AND "board_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "student_profiles" WHERE "category_id" = r."id" AND "board_id" IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:BOARD_REQUIRED', DETAIL = r."id"::text;
  END IF;
  IF r."requires_level" AND (
       EXISTS (SELECT 1 FROM "curricula" WHERE "category_id" = r."id" AND "level_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "student_profiles" WHERE "category_id" = r."id" AND "level_id" IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:LEVEL_REQUIRED', DETAIL = r."id"::text;
  END IF;
  RETURN NULL;
END $$;

COMMIT;
