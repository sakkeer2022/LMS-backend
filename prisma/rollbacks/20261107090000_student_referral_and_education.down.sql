-- Rollback of 20261107090000_student_referral_and_education. Drops the optional referral and education
-- answers students gave at registration; nothing else depends on them.
BEGIN;
ALTER TABLE "student_profiles" DROP CONSTRAINT IF EXISTS "student_profiles_referral_source_fkey";
ALTER TABLE "student_profiles" DROP CONSTRAINT IF EXISTS "student_profiles_referral_other_check";
ALTER TABLE "student_profiles"
DROP COLUMN IF EXISTS "referral_source",
DROP COLUMN IF EXISTS "referral_source_other",
DROP COLUMN IF EXISTS "education_level",
DROP COLUMN IF EXISTS "institution_name",
DROP COLUMN IF EXISTS "education_detail";
DROP TABLE IF EXISTS "referral_sources";
DROP TYPE IF EXISTS "EducationLevel";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261107090000_student_referral_and_education';
COMMIT;
