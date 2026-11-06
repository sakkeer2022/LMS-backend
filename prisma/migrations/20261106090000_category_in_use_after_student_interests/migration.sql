-- Re-creates category_in_use without student_profiles.category_id, which
-- 20261104120000_student_interests dropped (students reach a leaf through student_subjects).
-- A fresh database already has this definition from 20261105090000_category_simple_leaves;
-- this fixes databases that applied the earlier version of that migration.
CREATE OR REPLACE FUNCTION "category_in_use"(cat UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "curricula" cu
    WHERE cu."category_id" = cat AND (
         EXISTS (SELECT 1 FROM "faculty_assignments" fa WHERE fa."curriculum_id" = cu."id")
      OR EXISTS (SELECT 1 FROM "price_rules" pr WHERE pr."curriculum_id" = cu."id")
      OR EXISTS (SELECT 1 FROM "student_subjects" ss WHERE ss."curriculum_id" = cu."id")
      OR EXISTS (SELECT 1 FROM "library_materials" lm WHERE lm."curriculum_id" = cu."id")))
$$;
