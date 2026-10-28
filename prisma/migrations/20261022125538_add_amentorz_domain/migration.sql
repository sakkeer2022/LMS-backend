-- CreateEnum
CREATE TYPE "FacultyApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "FacultyDocumentType" AS ENUM ('GOVERNMENT_ID', 'DEGREE_CERTIFICATE', 'EXPERIENCE_LETTER', 'BACKGROUND_CHECK', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "LibraryMaterialKind" AS ENUM ('DOCUMENT', 'LINK');

-- CreateEnum
CREATE TYPE "LibraryMaterialAudience" AS ENUM ('STUDENT', 'FACULTY', 'ALL');

-- CreateEnum
CREATE TYPE "LibraryModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "student_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "date_of_birth" TIMESTAMP(3),
    "is_under_18" BOOLEAN NOT NULL DEFAULT false,
    "guardian_name" VARCHAR(150),
    "guardian_email" VARCHAR(255),
    "guardian_phone" VARCHAR(20),
    "guardian_consent_signed" BOOLEAN NOT NULL DEFAULT false,
    "guardian_consent_document" TEXT,
    "guardian_consent_signed_at" TIMESTAMP(3),
    "grade_level" VARCHAR(50),
    "school_name" VARCHAR(200),
    "city" VARCHAR(100),
    "state" VARCHAR(100),
    "country" VARCHAR(2) NOT NULL DEFAULT 'IN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "headline" VARCHAR(200),
    "bio" TEXT,
    "experience_years" DECIMAL(4,1),
    "primary_subject" VARCHAR(100),
    "approval_status" "FacultyApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "rejection_reason" TEXT,
    "approved_at" TIMESTAMP(3),
    "approved_by" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "ratings_average" DECIMAL(3,2) NOT NULL DEFAULT 0.00,
    "ratings_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_qualifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "faculty_id" UUID NOT NULL,
    "degree" VARCHAR(150) NOT NULL,
    "field_of_study" VARCHAR(150) NOT NULL,
    "institution" VARCHAR(200) NOT NULL,
    "year_of_passing" INTEGER NOT NULL,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_experiences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "faculty_id" UUID NOT NULL,
    "organization" VARCHAR(200) NOT NULL,
    "designation" VARCHAR(150) NOT NULL,
    "start_year" INTEGER NOT NULL,
    "end_year" INTEGER,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "faculty_id" UUID NOT NULL,
    "document_type" "FacultyDocumentType" NOT NULL,
    "original_file_name" VARCHAR(255) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "storage_key" VARCHAR(255) NOT NULL,
    "scan_status" "DocumentScanStatus" NOT NULL DEFAULT 'PENDING',
    "scan_result" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "verified_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_terms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" VARCHAR(20) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faculty_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_terms_acceptances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "faculty_id" UUID NOT NULL,
    "terms_id" UUID NOT NULL,
    "terms_version" VARCHAR(20) NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faculty_terms_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "requires_board" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "country" VARCHAR(2) NOT NULL DEFAULT 'IN',
    "state" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subjects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "levels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curricula" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "board_id" UUID,
    "subject_id" UUID NOT NULL,
    "level_id" UUID NOT NULL,
    "syllabus" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curricula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "faculty_id" UUID NOT NULL,
    "curriculum_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_prices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assignment_id" UUID NOT NULL,
    "price_paise" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_materials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "kind" "LibraryMaterialKind" NOT NULL,
    "audience" "LibraryMaterialAudience" NOT NULL DEFAULT 'STUDENT',
    "status" "LibraryModerationStatus" NOT NULL DEFAULT 'PENDING',
    "curriculum_id" UUID,
    "storage_key" VARCHAR(255),
    "file_size" INTEGER,
    "mime_type" VARCHAR(100),
    "external_url" TEXT,
    "scan_status" "DocumentScanStatus" NOT NULL DEFAULT 'PENDING',
    "uploaded_by" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "material_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "LibraryModerationStatus" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_user_id_key" ON "student_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_profiles_user_id_key" ON "faculty_profiles"("user_id");

-- CreateIndex
CREATE INDEX "faculty_profiles_approval_status_is_published_is_active_idx" ON "faculty_profiles"("approval_status", "is_published", "is_active");

-- CreateIndex
CREATE INDEX "faculty_qualifications_faculty_id_idx" ON "faculty_qualifications"("faculty_id");

-- CreateIndex
CREATE INDEX "faculty_experiences_faculty_id_idx" ON "faculty_experiences"("faculty_id");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_documents_storage_key_key" ON "faculty_documents"("storage_key");

-- CreateIndex
CREATE INDEX "faculty_documents_faculty_id_idx" ON "faculty_documents"("faculty_id");

-- CreateIndex
CREATE INDEX "faculty_documents_scan_status_idx" ON "faculty_documents"("scan_status");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_terms_version_key" ON "faculty_terms"("version");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_terms_acceptances_faculty_id_terms_id_key" ON "faculty_terms_acceptances"("faculty_id", "terms_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_code_key" ON "categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "boards_code_key" ON "boards"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_code_key" ON "subjects"("code");

-- CreateIndex
CREATE UNIQUE INDEX "levels_code_key" ON "levels"("code");

-- CreateIndex
CREATE UNIQUE INDEX "curricula_category_id_board_id_subject_id_level_id_key" ON "curricula"("category_id", "board_id", "subject_id", "level_id") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "faculty_assignments_faculty_id_curriculum_id_key" ON "faculty_assignments"("faculty_id", "curriculum_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_prices_assignment_id_key" ON "session_prices"("assignment_id");

-- CreateIndex
CREATE INDEX "library_materials_status_audience_idx" ON "library_materials"("status", "audience");

-- CreateIndex
CREATE INDEX "library_materials_curriculum_id_idx" ON "library_materials"("curriculum_id");

-- CreateIndex
CREATE INDEX "library_reviews_material_id_idx" ON "library_reviews"("material_id");

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_profiles" ADD CONSTRAINT "faculty_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_profiles" ADD CONSTRAINT "faculty_profiles_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_qualifications" ADD CONSTRAINT "faculty_qualifications_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculty_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_experiences" ADD CONSTRAINT "faculty_experiences_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculty_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_documents" ADD CONSTRAINT "faculty_documents_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculty_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_documents" ADD CONSTRAINT "faculty_documents_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_terms_acceptances" ADD CONSTRAINT "faculty_terms_acceptances_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculty_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_terms_acceptances" ADD CONSTRAINT "faculty_terms_acceptances_terms_id_fkey" FOREIGN KEY ("terms_id") REFERENCES "faculty_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curricula" ADD CONSTRAINT "curricula_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "levels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_assignments" ADD CONSTRAINT "faculty_assignments_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculty_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_assignments" ADD CONSTRAINT "faculty_assignments_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curricula"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_prices" ADD CONSTRAINT "session_prices_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "faculty_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_materials" ADD CONSTRAINT "library_materials_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_materials" ADD CONSTRAINT "library_materials_curriculum_id_fkey" FOREIGN KEY ("curriculum_id") REFERENCES "curricula"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_reviews" ADD CONSTRAINT "library_reviews_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "library_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_reviews" ADD CONSTRAINT "library_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
