-- Countries the platform serves (India and the UAE in Phase 1). A new country is a row, not a code change.
-- CreateTable
CREATE TABLE "countries" (
    "code" VARCHAR(2) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "dial_code" VARCHAR(5) NOT NULL,
    "mobile_pattern" VARCHAR(100) NOT NULL,
    "default_timezone" VARCHAR(64) NOT NULL,
    "guardian_consent_age" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "countries_dial_code_key" ON "countries"("dial_code");

-- Reference rows. They must exist before the foreign keys below, because boards and student profiles
-- already hold 'IN'. Mobile patterns match the national number after the dialling code (REGIONS.md).
-- The consent age of 18 is the team decision of 2026-10-29, still to be confirmed by the client (C8).
INSERT INTO "countries" ("code", "name", "dial_code", "mobile_pattern", "default_timezone", "guardian_consent_age", "display_order", "updated_at")
VALUES
    ('IN', 'India', '+91', '^[6-9][0-9]{9}$', 'Asia/Kolkata', 18, 1, CURRENT_TIMESTAMP),
    ('AE', 'United Arab Emirates', '+971', '^5[0-9]{8}$', 'Asia/Dubai', 18, 2, CURRENT_TIMESTAMP);

-- The student's country comes from the mobile number at registration, so no default country
-- AlterTable
ALTER TABLE "student_profiles" ALTER COLUMN "country" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_country_fkey" FOREIGN KEY ("country") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_country_fkey" FOREIGN KEY ("country") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
