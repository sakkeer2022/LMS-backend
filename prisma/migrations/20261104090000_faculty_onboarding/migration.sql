-- Faculty onboarding, review and price consent (LMS-39, LMS-40)

-- AlterEnum
ALTER TYPE "FacultyDocumentType" ADD VALUE 'PAN_CARD';

-- CreateEnum
CREATE TYPE "FacultyPriceConsentDecision" AS ENUM ('ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "faculty_profiles"
  ADD COLUMN "city" VARCHAR(100),
  ADD COLUMN "highest_qualification" VARCHAR(150),
  ADD COLUMN "studied_at" VARCHAR(200),
  ADD COLUMN "teaching_experience" VARCHAR(10),
  ADD COLUMN "offers_offline_classes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "application_reference" VARCHAR(20),
  ADD COLUMN "submitted_at" TIMESTAMP(3),
  ADD COLUMN "declaration_accepted_at" TIMESTAMP(3),
  ADD COLUMN "invitation_id" UUID,
  ADD COLUMN "access_ready_at" TIMESTAMP(3),
  ADD CONSTRAINT "faculty_profiles_teaching_experience_check"
    CHECK ("teaching_experience" IS NULL OR "teaching_experience" IN ('0-1', '1-3', '3-5', '5-10', '10+'));

-- CreateIndex
CREATE UNIQUE INDEX "faculty_profiles_application_reference_key" ON "faculty_profiles"("application_reference");
CREATE UNIQUE INDEX "faculty_profiles_invitation_id_key" ON "faculty_profiles"("invitation_id");

-- AddForeignKey
ALTER TABLE "faculty_profiles" ADD CONSTRAINT "faculty_profiles_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "faculty_invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Application references AMZ-T-1001, AMZ-T-1002, ... (hand-written; not modelled in schema.prisma)
CREATE SEQUENCE "faculty_application_reference_seq" AS BIGINT START WITH 1001;

-- CreateTable
CREATE TABLE "faculty_price_consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "faculty_id" UUID NOT NULL,
    "decision" "FacultyPriceConsentDecision" NOT NULL,
    "snapshot_hash" VARCHAR(64) NOT NULL,
    "price_snapshot" JSONB NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faculty_price_consents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "faculty_price_consents_snapshot_hash_check" CHECK ("snapshot_hash" ~ '^[0-9a-f]{64}$')
);

-- CreateIndex
CREATE INDEX "faculty_price_consents_faculty_id_decided_at_idx" ON "faculty_price_consents"("faculty_id", "decided_at");

-- AddForeignKey
ALTER TABLE "faculty_price_consents" ADD CONSTRAINT "faculty_price_consents_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculty_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
