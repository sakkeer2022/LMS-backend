-- Rollback of 20261112090000_subject_card_status_library_revisions (schema only).
-- Library revisions, card statuses and NOTE materials are lost; take a snapshot first.
-- The NOTE value cannot be removed from "LibraryMaterialKind" without recreating the type, so
-- NOTE rows are deleted and the value is left in place (harmless).
BEGIN;
ALTER TABLE "library_reviews" DROP CONSTRAINT IF EXISTS "library_reviews_revision_id_fkey";
ALTER TABLE "library_reviews" DROP COLUMN IF EXISTS "revision_id";
DROP TABLE IF EXISTS "library_material_revisions";
DELETE FROM "library_materials" WHERE "kind" = 'NOTE';
ALTER TABLE "library_materials" DROP CONSTRAINT IF EXISTS "library_materials_faculty_id_fkey";
DROP INDEX IF EXISTS "library_materials_faculty_id_curriculum_id_status_idx";
ALTER TABLE "library_materials" DROP COLUMN IF EXISTS "faculty_id", DROP COLUMN IF EXISTS "body",
    DROP COLUMN IF EXISTS "original_file_name";
DROP TRIGGER IF EXISTS "faculty_assignments_limit" ON "faculty_assignments";
DROP FUNCTION IF EXISTS "faculty_assignments_limit"();
DROP INDEX IF EXISTS "faculty_assignments_status_source_idx";
ALTER TABLE "faculty_assignments" DROP COLUMN IF EXISTS "status", DROP COLUMN IF EXISTS "source",
    DROP COLUMN IF EXISTS "requested_at", DROP COLUMN IF EXISTS "decided_at",
    DROP COLUMN IF EXISTS "decided_by_id", DROP COLUMN IF EXISTS "decision_reason";
DROP TYPE IF EXISTS "LibraryRevisionStatus";
DROP TYPE IF EXISTS "SubjectCardSource";
DROP TYPE IF EXISTS "SubjectCardStatus";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261112090000_subject_card_status_library_revisions';
COMMIT;
