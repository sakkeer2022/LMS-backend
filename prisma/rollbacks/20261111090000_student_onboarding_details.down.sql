-- Rollback of 20261111090000_student_onboarding_details. Drops the city and education stream students gave
-- at registration; nothing else depends on them.
BEGIN;
ALTER TABLE "student_profiles"
DROP COLUMN IF EXISTS "city",
DROP COLUMN IF EXISTS "education_stream";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261111090000_student_onboarding_details';
COMMIT;
