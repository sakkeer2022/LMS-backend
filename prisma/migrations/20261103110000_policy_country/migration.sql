-- Policies belong to a country (India and the UAE have different texts). Any policy row that exists before
-- this migration was created while the platform served India only (no policy loader existed yet), so those
-- legacy rows are tied to India once, here; nothing in application code defaults a country.
-- AlterTable
ALTER TABLE "policy_documents" ADD COLUMN "country" VARCHAR(2);
UPDATE "policy_documents" SET "country" = 'IN' WHERE "country" IS NULL;
ALTER TABLE "policy_documents" ALTER COLUMN "country" SET NOT NULL;

-- DropIndex
DROP INDEX "policy_documents_type_is_current_idx";

-- DropIndex
DROP INDEX "policy_documents_type_version_key";

-- CreateIndex
CREATE INDEX "policy_documents_type_country_is_current_idx" ON "policy_documents"("type", "country", "is_current");

-- CreateIndex
CREATE UNIQUE INDEX "policy_documents_type_country_version_key" ON "policy_documents"("type", "country", "version");

-- AddForeignKey
ALTER TABLE "policy_documents" ADD CONSTRAINT "policy_documents_country_fkey" FOREIGN KEY ("country") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one current version per policy type and country (a partial index, which Prisma does not model)
CREATE UNIQUE INDEX "policy_documents_current_per_type_country" ON "policy_documents"("type", "country") WHERE "is_current";
