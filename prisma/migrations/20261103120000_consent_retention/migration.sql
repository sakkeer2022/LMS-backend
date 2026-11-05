-- A signed guardian consent of a minor is a legal record. Deleting a student profile used to delete the
-- consent row (leaving its PDF behind in storage); it is now refused while the consent exists, so students
-- are soft-deleted and their consent is kept.
-- DropForeignKey
ALTER TABLE "guardian_consents" DROP CONSTRAINT "guardian_consents_student_id_fkey";

-- AddForeignKey
ALTER TABLE "guardian_consents" ADD CONSTRAINT "guardian_consents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "student_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
