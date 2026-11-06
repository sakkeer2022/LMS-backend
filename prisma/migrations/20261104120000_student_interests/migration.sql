-- A student chooses what to learn as a list of offerings (student_subjects -> curricula), and a
-- curriculum already carries its leaf, board, level and subject. The single category, board and level
-- on the profile could not hold "Class 9 Physics + JEE Physics + Guitar", so they are removed.
-- The preferred teaching language is no longer asked at onboarding; it stays as an optional column.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "student_profiles") THEN
    RAISE EXCEPTION 'student_profiles has rows; copy each profile''s category, board and level into student_subjects before dropping them';
  END IF;
END $$;

DROP TRIGGER "student_profiles_category_check" ON "student_profiles";
DROP INDEX "student_profiles_category_id_board_id_level_id_idx";
ALTER TABLE "student_profiles"
  DROP COLUMN "category_id",
  DROP COLUMN "board_id",
  DROP COLUMN "level_id",
  ALTER COLUMN "teaching_language_id" DROP NOT NULL;

-- Only curricula reference a leaf now; a student reaches it through student_subjects (RESTRICT)
CREATE OR REPLACE FUNCTION "category_reference_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ref_category UUID;
  ref_board UUID;
  ref_level UUID;
  c "categories"%ROWTYPE;
BEGIN
  SELECT "category_id", "board_id", "level_id" INTO ref_category, ref_board, ref_level
  FROM "curricula" WHERE "id" = NEW."id";
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

CREATE OR REPLACE FUNCTION "category_referenced_flags_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "categories"%ROWTYPE;
BEGIN
  SELECT * INTO r FROM "categories" WHERE "id" = NEW."id";
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT r."is_bookable" AND EXISTS (SELECT 1 FROM "curricula" WHERE "category_id" = r."id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:CATEGORY_REFERENCED', DETAIL = r."id"::text;
  END IF;
  IF r."requires_board" AND EXISTS (SELECT 1 FROM "curricula" WHERE "category_id" = r."id" AND "board_id" IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:BOARD_REQUIRED', DETAIL = r."id"::text;
  END IF;
  IF r."requires_level" AND EXISTS (SELECT 1 FROM "curricula" WHERE "category_id" = r."id" AND "level_id" IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:LEVEL_REQUIRED', DETAIL = r."id"::text;
  END IF;
  RETURN NULL;
END $$;

-- The integrity check no longer looks at the profile columns that are gone
CREATE OR REPLACE FUNCTION "category_tree_verify"()
RETURNS TABLE ("check_name" TEXT, "failures" BIGINT) LANGUAGE sql STABLE AS $$
  WITH RECURSIVE reachable AS (
    SELECT "id" FROM "categories" WHERE "parent_id" IS NULL
    UNION
    SELECT c."id" FROM "categories" c JOIN reachable r ON c."parent_id" = r."id"
  )
  SELECT 'root_shape', count(*) FROM "categories" WHERE "parent_id" IS NULL AND ("depth" <> 0 OR "path" <> "code")
  UNION ALL
  SELECT 'path_and_depth_match_parent', count(*) FROM "categories" c JOIN "categories" p ON p."id" = c."parent_id"
    WHERE c."path" <> p."path" || '/' || c."code" OR c."depth" <> p."depth" + 1
  UNION ALL
  SELECT 'unreachable_or_cyclic', (SELECT count(*) FROM "categories") - (SELECT count(*) FROM reachable)
  UNION ALL
  SELECT 'duplicate_path', count(*) FROM (SELECT "path" FROM "categories" GROUP BY "path" HAVING count(*) > 1) d
  UNION ALL
  SELECT 'bookable_with_children', count(*) FROM "categories" c
    WHERE c."is_bookable" AND EXISTS (SELECT 1 FROM "categories" ch WHERE ch."parent_id" = c."id")
  UNION ALL
  SELECT 'curricula_not_on_bookable_leaf', count(*) FROM "curricula" cu
    LEFT JOIN "categories" c ON c."id" = cu."category_id" WHERE c."id" IS NULL OR NOT c."is_bookable"
  UNION ALL
  SELECT 'curricula_level_not_allowed', count(*) FROM "curricula" cu
    WHERE cu."level_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "category_levels" cl WHERE cl."category_id" = cu."category_id" AND cl."level_id" = cu."level_id")
  UNION ALL
  SELECT 'curricula_missing_required_level', count(*) FROM "curricula" cu JOIN "categories" c ON c."id" = cu."category_id"
    WHERE c."requires_level" AND cu."level_id" IS NULL
  UNION ALL
  SELECT 'curricula_missing_required_board', count(*) FROM "curricula" cu JOIN "categories" c ON c."id" = cu."category_id"
    WHERE c."requires_board" AND cu."board_id" IS NULL
$$;

COMMIT;
