-- Category tree, expand phase (ADR-0005). Additive: nothing is dropped except the
-- global unique index on categories.code, which becomes sibling-unique because two
-- subsections under different tabs may share a code.
--
-- Before running in any shared environment: take a backup (see
-- prisma/rollbacks/README.md). Rollback: prisma/rollbacks/20261102090000_category_tree_expand.down.sql
--
-- The whole migration is one transaction. The backfill is verified at the end, and
-- any failed check aborts it, so no partial state is ever visible.
BEGIN;

-- ── 0. Preconditions ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "categories" WHERE "code" IN ('academic', 'non-academic')) THEN
    RAISE EXCEPTION 'category_tree expand: a category with code academic or non-academic already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM "categories" WHERE "code" !~ '^[a-z][a-z0-9_-]*$') THEN
    RAISE EXCEPTION 'category_tree expand: category codes must match ^[a-z][a-z0-9_-]*$ (%)',
      (SELECT string_agg("code", ', ') FROM "categories" WHERE "code" !~ '^[a-z][a-z0-9_-]*$');
  END IF;
  IF EXISTS (SELECT 1 FROM "catalogue_nodes" WHERE "type" = 'SUBSECTION' AND (length("slug") > 50 OR length("name") > 100)) THEN
    RAISE EXCEPTION 'category_tree expand: a subsection slug is longer than 50 or its name longer than 100 characters';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "catalogue_nodes" s JOIN "catalogue_nodes" p ON p."id" = s."parent_id"
    WHERE s."type" = 'SUBSECTION' AND p."type" <> 'CATEGORY'
  ) THEN
    RAISE EXCEPTION 'category_tree expand: a subsection is not directly under a category node';
  END IF;
END $$;

-- Counts before the backfill, compared at the end
CREATE TEMP TABLE "_category_tree_counts" ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM "categories") AS categories,
  (SELECT count(*) FROM "curricula") AS curricula,
  (SELECT count(*) FROM "student_profiles") AS profiles,
  (SELECT count(*) FROM "catalogue_nodes" WHERE "type" = 'SUBSECTION') AS subsections;

-- ── 1. New columns and table (nullable or defaulted) ─────────────────────────
ALTER TABLE "categories"
  ADD COLUMN "parent_id" UUID,
  ADD COLUMN "path" VARCHAR(500),
  ADD COLUMN "depth" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "is_bookable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requires_level" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "category_levels" (
  "category_id" UUID NOT NULL,
  "level_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "category_levels_pkey" PRIMARY KEY ("category_id", "level_id")
);
CREATE INDEX "category_levels_level_id_idx" ON "category_levels"("level_id");
ALTER TABLE "category_levels" ADD CONSTRAINT "category_levels_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "category_levels" ADD CONSTRAINT "category_levels_level_id_fkey"
  FOREIGN KEY ("level_id") REFERENCES "levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Codes are unique among siblings (roots included, hence NULLS NOT DISTINCT), not globally
DROP INDEX "categories_code_key";
CREATE UNIQUE INDEX "categories_parent_id_code_key" ON "categories"("parent_id", "code") NULLS NOT DISTINCT;

-- ── 2. Backfill ──────────────────────────────────────────────────────────────
-- 2a. New roots
INSERT INTO "categories" ("id", "code", "name", "requires_board", "is_active", "display_order",
                          "updated_at", "parent_id", "path", "depth", "is_bookable", "requires_level")
VALUES (gen_random_uuid(), 'academic', 'Academic', false, true, 1, now(), NULL, 'academic', 0, false, false),
       (gen_random_uuid(), 'non-academic', 'Non-academic', false, true, 2, now(), NULL, 'non-academic', 0, false, false);

-- 2b. The frontline tabs become depth 1 (Research & Skill under Non-academic, every other tab under Academic)
UPDATE "categories" c
SET "parent_id" = r."id",
    "path" = r."code" || '/' || c."code",
    "depth" = 1,
    "updated_at" = now()
FROM "categories" r
WHERE c."path" IS NULL
  AND r."code" = CASE WHEN c."code" = 'research-skill' THEN 'non-academic' ELSE 'academic' END
  AND r."parent_id" IS NULL;

-- 2c. Legacy SUBSECTION nodes become child categories with the same id
INSERT INTO "categories" ("id", "code", "name", "requires_board", "is_active", "display_order",
                          "created_at", "updated_at", "parent_id", "path", "depth")
SELECT s."id", s."slug", s."name", tab."requires_board", s."status" = 'PUBLISHED', s."sort_order",
       s."created_at", now(), tab."id", tab."path" || '/' || s."slug", 2
FROM "catalogue_nodes" s
JOIN "catalogue_nodes" root ON root."id" = s."parent_id"
JOIN "categories" tab ON tab."id" = root."category_id"
WHERE s."type" = 'SUBSECTION';

-- 2d. Curricula owned by a leaf under a subsection now belong to that subsection
WITH RECURSIVE ancestors AS (
  SELECT n."id" AS leaf_id, n."parent_id" AS ancestor_id
  FROM "catalogue_nodes" n WHERE n."type" = 'LEVEL'
  UNION ALL
  SELECT a.leaf_id, p."parent_id"
  FROM ancestors a JOIN "catalogue_nodes" p ON p."id" = a.ancestor_id
  WHERE p."parent_id" IS NOT NULL
)
UPDATE "curricula" c
SET "category_id" = s."id", "updated_at" = now()
FROM ancestors a
JOIN "catalogue_nodes" s ON s."id" = a.ancestor_id AND s."type" = 'SUBSECTION'
WHERE c."node_id" = a.leaf_id;

-- 2e. A tab that now has children cannot stay bookable: curricula still pointing at it
--     move to a new "general" leaf under it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "categories" t
    WHERE t."depth" = 1
      AND EXISTS (SELECT 1 FROM "categories" ch WHERE ch."parent_id" = t."id" AND ch."code" = 'general')
      AND EXISTS (SELECT 1 FROM "curricula" cu WHERE cu."category_id" = t."id")
  ) THEN
    RAISE EXCEPTION 'category_tree expand: a tab needs a "general" leaf but already has a child with code general';
  END IF;
END $$;

INSERT INTO "categories" ("id", "code", "name", "requires_board", "is_active", "display_order",
                          "updated_at", "parent_id", "path", "depth")
SELECT gen_random_uuid(), 'general', 'General', t."requires_board", true, 0, now(), t."id", t."path" || '/general', t."depth" + 1
FROM "categories" t
WHERE t."depth" = 1
  AND EXISTS (SELECT 1 FROM "categories" ch WHERE ch."parent_id" = t."id")
  AND EXISTS (SELECT 1 FROM "curricula" cu WHERE cu."category_id" = t."id");

UPDATE "curricula" c
SET "category_id" = g."id", "updated_at" = now()
FROM "categories" g
WHERE g."parent_id" = c."category_id" AND g."code" = 'general';

-- 2f. Existing leaves are bookable and need a level; only leaves are bookable. The two
--     new roots are skipped: on an empty database they have no children yet.
UPDATE "categories" c
SET "is_bookable" = NOT EXISTS (SELECT 1 FROM "categories" ch WHERE ch."parent_id" = c."id"),
    "requires_level" = NOT EXISTS (SELECT 1 FROM "categories" ch WHERE ch."parent_id" = c."id")
WHERE c."parent_id" IS NOT NULL;

-- 2g. Allowed levels: the levels scoped to the leaf's tab, plus every level its curricula use
INSERT INTO "category_levels" ("category_id", "level_id")
SELECT leaf."id", l."id"
FROM "categories" leaf
JOIN "categories" tab ON tab."path" = split_part(leaf."path", '/', 1) || '/' || split_part(leaf."path", '/', 2)
JOIN "levels" l ON l."category_id" = tab."id"
WHERE leaf."is_bookable"
ON CONFLICT DO NOTHING;

INSERT INTO "category_levels" ("category_id", "level_id")
SELECT DISTINCT "category_id", "level_id" FROM "curricula" WHERE "level_id" IS NOT NULL
ON CONFLICT DO NOTHING;

-- 2h. Student profiles on a tab that is no longer a leaf: the single leaf all the
--     student's subjects belong to, otherwise the tab's only bookable leaf
UPDATE "student_profiles" sp
SET "category_id" = pick.leaf_id, "updated_at" = now()
FROM (
  SELECT sp2."id" AS profile_id, min(cu."category_id"::text)::uuid AS leaf_id
  FROM "student_profiles" sp2
  JOIN "categories" c ON c."id" = sp2."category_id" AND NOT c."is_bookable"
  JOIN "student_subjects" ss ON ss."student_id" = sp2."id"
  JOIN "curricula" cu ON cu."id" = ss."curriculum_id"
  GROUP BY sp2."id"
  HAVING count(DISTINCT cu."category_id") = 1
) pick
WHERE sp."id" = pick.profile_id;

UPDATE "student_profiles" sp
SET "category_id" = only_leaf.leaf_id, "updated_at" = now()
FROM (
  SELECT t."id" AS tab_id, min(l."id"::text)::uuid AS leaf_id
  FROM "categories" t
  JOIN "categories" l ON l."path" LIKE t."path" || '/%' AND l."is_bookable"
  WHERE NOT t."is_bookable"
  GROUP BY t."id"
  HAVING count(*) = 1
) only_leaf
WHERE sp."category_id" = only_leaf.tab_id;

-- ── 3. Constraints, indexes and the tree trigger ─────────────────────────────
ALTER TABLE "categories" ALTER COLUMN "path" SET NOT NULL;
CREATE UNIQUE INDEX "categories_path_key" ON "categories"("path");
-- Prefix queries (subtree, "under this branch") need a pattern-ops btree outside the C locale
CREATE INDEX "categories_path_pattern_idx" ON "categories"("path" text_pattern_ops);
-- Deactivated branches are few; learner reads check "no inactive ancestor" against this
CREATE INDEX "categories_inactive_path_idx" ON "categories"("path" text_pattern_ops) WHERE NOT "is_active";
CREATE INDEX "categories_parent_id_display_order_idx" ON "categories"("parent_id", "display_order");
-- Learner catalogue: active bookable leaves
CREATE INDEX "categories_bookable_path_idx" ON "categories"("path" text_pattern_ops) WHERE "is_bookable" AND "is_active";

ALTER TABLE "categories" ADD CONSTRAINT "categories_root_check" CHECK (("parent_id" IS NULL) = ("depth" = 0));
ALTER TABLE "categories" ADD CONSTRAINT "categories_not_own_parent_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
ALTER TABLE "categories" ADD CONSTRAINT "categories_code_format_check" CHECK ("code" ~ '^[a-z][a-z0-9_-]*$');
ALTER TABLE "categories" ADD CONSTRAINT "categories_path_ends_with_code_check"
  CHECK ("path" = "code" OR right("path", length("code") + 1) = '/' || "code");
ALTER TABLE "categories" ADD CONSTRAINT "categories_depth_check" CHECK ("depth" >= 0 AND "depth" <= 20);
ALTER TABLE "categories" ADD CONSTRAINT "categories_version_check" CHECK ("version" >= 1);

-- Checked at commit, so a move may rewrite a whole subtree in one statement. Each changed
-- row is checked against its parent and its children; depth strictly increases along
-- every edge, so a consistent tree has no cycle. FOR SHARE on the parent serialises a
-- concurrent child insert with a move or a "make bookable" of that parent.
CREATE OR REPLACE FUNCTION "category_tree_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r "categories"%ROWTYPE;
  p "categories"%ROWTYPE;
BEGIN
  SELECT * INTO r FROM "categories" WHERE "id" = NEW."id";
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF r."parent_id" IS NULL THEN
    IF r."depth" <> 0 OR r."path" <> r."code" THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:PATH_MISMATCH', DETAIL = r."id"::text;
    END IF;
  ELSE
    SELECT * INTO p FROM "categories" WHERE "id" = r."parent_id" FOR SHARE;
    IF r."path" <> p."path" || '/' || r."code" OR r."depth" <> p."depth" + 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:PATH_MISMATCH', DETAIL = r."id"::text;
    END IF;
    IF p."is_bookable" THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:PARENT_IS_BOOKABLE', DETAIL = p."id"::text;
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "categories" c
    WHERE c."parent_id" = r."id" AND (c."path" <> r."path" || '/' || c."code" OR c."depth" <> r."depth" + 1)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:PATH_MISMATCH', DETAIL = r."id"::text;
  END IF;
  IF r."is_bookable" AND EXISTS (SELECT 1 FROM "categories" c WHERE c."parent_id" = r."id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'category_tree:BOOKABLE_HAS_CHILDREN', DETAIL = r."id"::text;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "categories_tree_check"
  AFTER INSERT OR UPDATE ON "categories"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "category_tree_check"();

-- ── 4. Verification (also run before the contract phase and in staging) ──────
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
  SELECT 'profiles_not_on_bookable_leaf', count(*) FROM "student_profiles" sp
    LEFT JOIN "categories" c ON c."id" = sp."category_id" WHERE c."id" IS NULL OR NOT c."is_bookable"
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
  UNION ALL
  SELECT 'profiles_missing_required_board', count(*) FROM "student_profiles" sp JOIN "categories" c ON c."id" = sp."category_id"
    WHERE c."requires_board" AND sp."board_id" IS NULL
$$;

DO $$
DECLARE
  failed TEXT;
  before RECORD;
  generals BIGINT;
BEGIN
  SELECT string_agg("check_name" || '=' || "failures", ', ') INTO failed
  FROM "category_tree_verify"() WHERE "failures" > 0;
  IF failed IS NOT NULL THEN
    RAISE EXCEPTION 'category_tree expand: verification failed: %', failed;
  END IF;

  SELECT * INTO before FROM "_category_tree_counts";
  SELECT count(*) INTO generals FROM "categories" c
  WHERE c."code" = 'general' AND c."depth" = 2
    AND NOT EXISTS (SELECT 1 FROM "catalogue_nodes" n WHERE n."id" = c."id");
  IF (SELECT count(*) FROM "curricula") <> before.curricula
     OR (SELECT count(*) FROM "student_profiles") <> before.profiles
     OR (SELECT count(*) FROM "categories") <> before.categories + 2 + before.subsections + generals THEN
    RAISE EXCEPTION 'category_tree expand: row counts do not match after the backfill';
  END IF;
END $$;

COMMIT;
