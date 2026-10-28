-- CreateEnum
CREATE TYPE "GuardianRelationship" AS ENUM ('FATHER', 'MOTHER', 'LEGAL_GUARDIAN', 'GRANDPARENT', 'SIBLING', 'OTHER');

-- CreateEnum
CREATE TYPE "PolicyType" AS ENUM ('TERMS_OF_USE', 'PRIVACY_POLICY', 'CHILD_SAFETY_POLICY', 'STUDENT_TERMS');

-- CreateEnum
CREATE TYPE "SignatureMode" AS ENUM ('DRAW', 'TYPE');

-- AlterTable
ALTER TABLE "email_challenges" ADD COLUMN     "registration_token_consumed_at" TIMESTAMP(3),
ADD COLUMN     "registration_token_expires_at" TIMESTAMP(3),
ADD COLUMN     "registration_token_hash" VARCHAR(64);

-- Hand-edited guard: the new learning-profile columns are NOT NULL with no
-- derivable value, so existing profiles cannot be migrated automatically.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "student_profiles") THEN
    RAISE EXCEPTION 'student_profiles has rows; backfill category, level and teaching language before applying this migration';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "student_profiles" DROP COLUMN "city",
DROP COLUMN "grade_level",
DROP COLUMN "guardian_consent_document",
DROP COLUMN "guardian_consent_signed",
DROP COLUMN "guardian_consent_signed_at",
DROP COLUMN "guardian_phone",
DROP COLUMN "is_under_18",
DROP COLUMN "school_name",
DROP COLUMN "state",
ADD COLUMN     "board_id" UUID,
ADD COLUMN     "category_id" UUID NOT NULL,
ADD COLUMN     "guardian_mobile_number" VARCHAR(16),
ADD COLUMN     "guardian_receives_reports" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "guardian_relationship" "GuardianRelationship",
ADD COLUMN     "level_id" UUID NOT NULL,
ADD COLUMN     "teaching_language_id" UUID NOT NULL,
ALTER COLUMN "date_of_birth" SET NOT NULL,
ALTER COLUMN "date_of_birth" SET DATA TYPE DATE;

-- AlterTable: single full-name field (onboarding step 1). Hand-edited so existing
-- names are carried over instead of dropped.
ALTER TABLE "users" ADD COLUMN     "full_name" VARCHAR(150),
ADD COLUMN     "mobile_number" VARCHAR(16),
ADD COLUMN     "timezone" VARCHAR(64);

UPDATE "users" SET "full_name" = LEFT(BTRIM(CONCAT_WS(' ', "first_name", "last_name")), 150);

ALTER TABLE "users" ALTER COLUMN "full_name" SET NOT NULL,
DROP COLUMN "first_name",
DROP COLUMN "last_name";

-- CreateTable
CREATE TABLE "student_subjects" (
    "student_id" UUID NOT NULL,
    "curriculum_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_subjects_pkey" PRIMARY KEY ("student_id","curriculum_id")
);

-- CreateTable
CREATE TABLE "teaching_languages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "language_codes" VARCHAR(8)[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teaching_languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "PolicyType" NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "storage_key" VARCHAR(255) NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_acceptances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian_consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID,
    "policy_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "student_full_name" VARCHAR(150) NOT NULL,
    "student_date_of_birth" DATE NOT NULL,
    "signature_mode" "SignatureMode" NOT NULL,
    "typed_name" VARCHAR(150),
    "signed_pdf_storage_key" VARCHAR(255) NOT NULL,
    "signed_pdf_sha256" VARCHAR(64) NOT NULL,
    "ip_address" VARCHAR(45) NOT NULL,
    "user_agent" TEXT,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "linked_at" TIMESTAMP(3),
    "guardian_name" VARCHAR(150),
    "guardian_relationship" "GuardianRelationship",

    CONSTRAINT "guardian_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_subjects_curriculum_id_idx" ON "student_subjects"("curriculum_id");

-- CreateIndex
CREATE UNIQUE INDEX "teaching_languages_code_key" ON "teaching_languages"("code");

-- CreateIndex
CREATE UNIQUE INDEX "policy_documents_storage_key_key" ON "policy_documents"("storage_key");

-- CreateIndex
CREATE INDEX "policy_documents_type_is_current_idx" ON "policy_documents"("type", "is_current");

-- CreateIndex
CREATE UNIQUE INDEX "policy_documents_type_version_key" ON "policy_documents"("type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "policy_acceptances_user_id_policy_id_key" ON "policy_acceptances"("user_id", "policy_id");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_consents_token_hash_key" ON "guardian_consents"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_consents_signed_pdf_storage_key_key" ON "guardian_consents"("signed_pdf_storage_key");

-- CreateIndex
CREATE INDEX "guardian_consents_expires_at_linked_at_idx" ON "guardian_consents"("expires_at", "linked_at");

-- CreateIndex
CREATE UNIQUE INDEX "guardian_consents_student_id_policy_id_key" ON "guardian_consents"("student_id", "policy_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_challenges_registration_token_hash_key" ON "email_challenges"("registration_token_hash");

-- CreateIndex
CREATE INDEX "student_profiles_category_id_board_id_level_id_idx" ON "student_profiles"("category_id", "board_id", "level_id");

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_teaching_language_id_fkey" FOREIGN KEY ("teaching_language_id") REFERENCES "teaching_languages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_subjects" ADD CONSTRAINT "student_subjects_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curricula"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policy_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_consents" ADD CONSTRAINT "guardian_consents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_consents" ADD CONSTRAINT "guardian_consents_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policy_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
