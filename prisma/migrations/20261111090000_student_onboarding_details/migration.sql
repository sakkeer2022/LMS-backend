-- Student onboarding enhancements (LMS-105): the city asked on step 1 and the optional stream within the
-- education answer. Additive only: both columns are nullable, so students registered earlier are untouched.
ALTER TABLE "student_profiles"
ADD COLUMN "city" VARCHAR(100),
ADD COLUMN "education_stream" VARCHAR(100);
