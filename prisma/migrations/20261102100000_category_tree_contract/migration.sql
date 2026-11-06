-- Category tree, contract phase (ADR-0005). Ship this only after the expand phase is
-- verified in staging (prisma/rollbacks/README.md). It re-runs the verification first
-- and aborts if anything fails.
-- Rollback: prisma/rollbacks/20261102100000_category_tree_contract.down.sql
BEGIN;

DO $$
DECLARE failed TEXT;
BEGIN
  SELECT string_agg("check_name" || '=' || "failures", ', ') INTO failed
  FROM "category_tree_verify"() WHERE "failures" > 0;
  IF failed IS NOT NULL THEN
    RAISE EXCEPTION 'category_tree contract: verification failed: %', failed;
  END IF;
END $$;

-- A leaf may not need a level (requires_level = false)
ALTER TABLE "curricula" ALTER COLUMN "level_id" DROP NOT NULL;

-- A curriculum's level must be one its leaf allows. MATCH SIMPLE: a null level skips the check,
-- and the trigger below decides whether null is allowed.
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_category_id_level_id_fkey"
  FOREIGN KEY ("category_id", "level_id") REFERENCES "category_levels"("category_id", "level_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The natural key (category_id, board_id, subject_id, level_id) already has a NULLS NOT
-- DISTINCT unique index (curricula_category_id_board_id_subject_id_level_id_key), so a
-- null level is still unique per leaf, board and subject. Nothing to replace.

-- Curricula and student profiles must reference a bookable leaf and satisfy its
-- requires_board / requires_level flags. FOR SHARE serialises with a concurrent change
-- of the leaf's flags.
CREATE OR REPLACE FUNCTION "category_reference_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ref_category UUID;
  ref_board UUID;
  ref_level UUID;
  c "categories"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'curricula' THEN
    SELECT "category_id", "board_id", "level_id" INTO ref_category, ref_board, ref_level
    FROM "curricula" WHERE "id" = NEW."id";
  ELSE
    SELECT "category_id", "board_id", "level_id" INTO ref_category, ref_board, ref_level
    FROM "student_profiles" WHERE "id" = NEW."id";
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO c FROM "categories" WHERE "id" = ref_category FOR SHARE;
  IF NOT c."is_bookable" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:CATEGORY_NOT_BOOKABLE', DETAIL = c."id"::text;
  END IF;
  IF c."requires_board" AND ref_board IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:BOARD_REQUIRED', DETAIL = c."id"::text;
  END IF;
  IF c."requires_level" AND ref_level IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:LEVEL_REQUIRED', DETAIL = c."id"::text;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "curricula_category_check"
  AFTER INSERT OR UPDATE OF "category_id", "board_id", "level_id" ON "curricula"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "category_reference_check"();

CREATE CONSTRAINT TRIGGER "student_profiles_category_check"
  AFTER INSERT OR UPDATE OF "category_id", "board_id", "level_id" ON "student_profiles"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "category_reference_check"();

-- The other direction: a category's flags may not change in a way that invalidates the
-- curricula or profiles already pointing at it.
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
  IF r."requires_level" AND EXISTS (SELECT 1 FROM "curricula" WHERE "category_id" = r."id" AND "level_id" IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:LEVEL_REQUIRED', DETAIL = r."id"::text;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "categories_reference_check"
  AFTER UPDATE OF "is_bookable", "requires_board", "requires_level" ON "categories"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "category_referenced_flags_check"();

COMMIT;
