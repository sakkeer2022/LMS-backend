-- Client feedback on faculty onboarding (LMS-0): re-upload requests, teaching mode, additional documents
-- and the signed price consent. Additive only: existing tutors keep their data, and every new column is
-- nullable or has a default.

-- CreateEnum
CREATE TYPE "FacultyReuploadStatus" AS ENUM ('PENDING', 'COMPLETED', 'SUPERSEDED');

-- CreateTable: "Preferred mode of teaching" options on onboarding step 1
CREATE TABLE "teaching_modes" (
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "offers_offline" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teaching_modes_pkey" PRIMARY KEY ("code")
);

INSERT INTO "teaching_modes" ("code", "name", "offers_offline", "display_order", "updated_at")
VALUES
    ('online', 'Online', false, 1, CURRENT_TIMESTAMP),
    ('offline', 'Offline / In-Person', true, 2, CURRENT_TIMESTAMP),
    ('hybrid', 'Hybrid (Both Online & Offline)', true, 3, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "faculty_profiles" ADD COLUMN "teaching_mode" VARCHAR(20);

-- Existing tutors: the old checkbox meant "I also take offline classes"
UPDATE "faculty_profiles"
SET "teaching_mode" = CASE WHEN "offers_offline_classes" THEN 'hybrid' ELSE 'online' END
WHERE "submitted_at" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "faculty_profiles" ADD CONSTRAINT "faculty_profiles_teaching_mode_fkey" FOREIGN KEY ("teaching_mode") REFERENCES "teaching_modes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: an admin's "request re-upload" with its single-use link (only the SHA-256 hash is stored)
CREATE TABLE "faculty_reupload_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "faculty_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "FacultyReuploadStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "requested_by_id" UUID,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_reupload_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "faculty_reupload_requests_token_hash_key" ON "faculty_reupload_requests"("token_hash");
CREATE INDEX "faculty_reupload_requests_faculty_id_status_idx" ON "faculty_reupload_requests"("faculty_id", "status");
-- At most one open request per tutor; a new request supersedes the previous one
CREATE UNIQUE INDEX "faculty_reupload_requests_one_pending" ON "faculty_reupload_requests"("faculty_id") WHERE "status" = 'PENDING';

ALTER TABLE "faculty_reupload_requests" ADD CONSTRAINT "faculty_reupload_requests_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculty_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "faculty_reupload_requests" ADD CONSTRAINT "faculty_reupload_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: the drawn signature the tutor gives when accepting prices (private storage key)
ALTER TABLE "faculty_price_consents" ADD COLUMN "signature_storage_key" VARCHAR(255);
CREATE UNIQUE INDEX "faculty_price_consents_signature_storage_key_key" ON "faculty_price_consents"("signature_storage_key");
