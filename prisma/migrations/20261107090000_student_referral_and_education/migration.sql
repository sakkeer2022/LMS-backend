-- Optional onboarding questions asked on the review step: how the student heard about Amentorz, and their
-- education. Additive only: every new column is nullable, so existing students are untouched.
-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('SCHOOL', 'UNDERGRADUATE', 'POSTGRADUATE', 'WORKING', 'OTHER');

-- CreateTable
CREATE TABLE "referral_sources" (
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_sources_pkey" PRIMARY KEY ("code")
);

-- Reference rows the review step offers; "other" lets the student write their own.
INSERT INTO "referral_sources" ("code", "name", "display_order", "updated_at")
VALUES
    ('friend_family', 'Friend or family', 1, CURRENT_TIMESTAMP),
    ('school_teacher', 'School or teacher', 2, CURRENT_TIMESTAMP),
    ('instagram', 'Instagram', 3, CURRENT_TIMESTAMP),
    ('youtube', 'YouTube', 4, CURRENT_TIMESTAMP),
    ('whatsapp', 'WhatsApp', 5, CURRENT_TIMESTAMP),
    ('google_search', 'Google search', 6, CURRENT_TIMESTAMP),
    ('poster_ad', 'Poster or ad', 7, CURRENT_TIMESTAMP),
    ('news_blog', 'News or blog', 8, CURRENT_TIMESTAMP),
    ('other', 'Other', 9, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "student_profiles"
ADD COLUMN "referral_source" VARCHAR(30),
ADD COLUMN "referral_source_other" VARCHAR(100),
ADD COLUMN "education_level" "EducationLevel",
ADD COLUMN "institution_name" VARCHAR(150),
ADD COLUMN "education_detail" VARCHAR(100);

-- The "other" text only goes with the "other" option
ALTER TABLE "student_profiles"
ADD CONSTRAINT "student_profiles_referral_other_check"
CHECK ("referral_source_other" IS NULL OR "referral_source" = 'other');

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_referral_source_fkey" FOREIGN KEY ("referral_source") REFERENCES "referral_sources"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
