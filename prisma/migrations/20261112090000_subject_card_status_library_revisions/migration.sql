-- Subject cards after onboarding and the faculty library (decided 2026-11-12, see docs/PENDING_DECISIONS.md).
--   * faculty_assignments (subject cards) gain an approval status and where they came from. Existing
--     cards of approved tutors are APPROVED; every other card waits for the application review.
--   * library_materials gain the owning tutor, a NOTE kind with a plain-text body and the file name.
--   * library_material_revisions: every submission (first upload and each edit) with its review, so an
--     edit of an approved resource waits for review while the approved version stays live.
-- Additive only: new columns are nullable or have defaults.
-- Rollback: prisma/rollbacks/20261112090000_subject_card_status_library_revisions.down.sql

-- CreateEnum
CREATE TYPE "SubjectCardStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "SubjectCardSource" AS ENUM ('ONBOARDING', 'PROFILE');
CREATE TYPE "LibraryRevisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "LibraryMaterialKind" ADD VALUE IF NOT EXISTS 'NOTE';

-- AlterTable: subject cards
ALTER TABLE "faculty_assignments"
    ADD COLUMN "status" "SubjectCardStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "source" "SubjectCardSource" NOT NULL DEFAULT 'ONBOARDING',
    ADD COLUMN "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "decided_at" TIMESTAMP(3),
    ADD COLUMN "decided_by_id" UUID,
    ADD COLUMN "decision_reason" TEXT;

-- Backfill: cards of approved tutors were approved with the application
UPDATE "faculty_assignments" fa
SET "status" = 'APPROVED', "decided_at" = fp."approved_at", "decided_by_id" = fp."approved_by",
    "requested_at" = fa."created_at"
FROM "faculty_profiles" fp
WHERE fp."id" = fa."faculty_id" AND fp."approval_status" = 'APPROVED';
UPDATE "faculty_assignments" SET "requested_at" = "created_at" WHERE "status" = 'PENDING';

CREATE INDEX "faculty_assignments_status_source_idx" ON "faculty_assignments"("status", "source");

-- At most 5 subject cards per tutor that are still chosen and not rejected (MAX_SUBJECT_CARDS in
-- src/modules/faculty/faculty.subject-cards.rules.ts; keep both in step). The services check first and
-- answer with a message; this is the backstop for every write path. Checked only when a card starts
-- holding a slot, so tutors who already hold more keep their cards. The profile row lock (NO KEY UPDATE,
-- which does not conflict with the foreign key's KEY SHARE) serialises concurrent requests of one tutor.
CREATE OR REPLACE FUNCTION "faculty_assignments_limit"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  held INTEGER;
BEGIN
  IF NOT (NEW."is_active" AND NEW."status" IN ('PENDING', 'APPROVED')) THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND OLD."is_active" AND OLD."status" IN ('PENDING', 'APPROVED') THEN RETURN NULL; END IF;
  PERFORM 1 FROM "faculty_profiles" WHERE "id" = NEW."faculty_id" FOR NO KEY UPDATE;
  SELECT count(*) INTO held FROM "faculty_assignments"
  WHERE "faculty_id" = NEW."faculty_id" AND "is_active" AND "status" IN ('PENDING', 'APPROVED');
  IF held > 5 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'subject_cards:LIMIT_REACHED', DETAIL = NEW."faculty_id"::text;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "faculty_assignments_limit"
AFTER INSERT OR UPDATE OF "is_active", "status" ON "faculty_assignments"
FOR EACH ROW EXECUTE FUNCTION "faculty_assignments_limit"();

-- AlterTable: library materials
ALTER TABLE "library_materials"
    ADD COLUMN "faculty_id" UUID,
    ADD COLUMN "body" TEXT,
    ADD COLUMN "original_file_name" VARCHAR(255);

CREATE INDEX "library_materials_faculty_id_curriculum_id_status_idx" ON "library_materials"("faculty_id", "curriculum_id", "status");

ALTER TABLE "library_materials" ADD CONSTRAINT "library_materials_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculty_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "library_material_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "material_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "LibraryRevisionStatus" NOT NULL DEFAULT 'PENDING',
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "kind" "LibraryMaterialKind" NOT NULL,
    "body" TEXT,
    "storage_key" VARCHAR(255),
    "original_file_name" VARCHAR(255),
    "file_size" INTEGER,
    "mime_type" VARCHAR(100),
    "submitted_by_id" UUID NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_material_revisions_pkey" PRIMARY KEY ("id"),
    -- A file resource carries a file; a note carries a body
    CONSTRAINT "library_material_revisions_content_check" CHECK (
        ("kind"::text <> 'NOTE' OR "body" IS NOT NULL) AND ("kind"::text <> 'DOCUMENT' OR "storage_key" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "library_material_revisions_material_id_revision_key" ON "library_material_revisions"("material_id", "revision");
CREATE INDEX "library_material_revisions_status_submitted_at_idx" ON "library_material_revisions"("status", "submitted_at");
-- At most one submission waiting for review per material
CREATE UNIQUE INDEX "library_material_revisions_one_pending" ON "library_material_revisions"("material_id") WHERE "status" = 'PENDING';

ALTER TABLE "library_material_revisions" ADD CONSTRAINT "library_material_revisions_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "library_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: reviews point at the submission they decided
ALTER TABLE "library_reviews" ADD COLUMN "revision_id" UUID;
ALTER TABLE "library_reviews" ADD CONSTRAINT "library_reviews_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "library_material_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
