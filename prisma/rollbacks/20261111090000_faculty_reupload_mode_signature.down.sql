-- Rollback of 20261111090000_faculty_reupload_mode_signature. Drops re-upload requests, the teaching mode
-- and the consent signature keys (the signature files stay in storage until removed by hand).
BEGIN;
DROP INDEX IF EXISTS "faculty_price_consents_signature_storage_key_key";
ALTER TABLE "faculty_price_consents" DROP COLUMN IF EXISTS "signature_storage_key";
DROP TABLE IF EXISTS "faculty_reupload_requests";
ALTER TABLE "faculty_profiles" DROP CONSTRAINT IF EXISTS "faculty_profiles_teaching_mode_fkey";
ALTER TABLE "faculty_profiles" DROP COLUMN IF EXISTS "teaching_mode";
DROP TABLE IF EXISTS "teaching_modes";
DROP TYPE IF EXISTS "FacultyReuploadStatus";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261111090000_faculty_reupload_mode_signature';
COMMIT;
