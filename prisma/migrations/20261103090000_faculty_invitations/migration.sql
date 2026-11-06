-- Faculty invitations (LMS-79)

-- CreateEnum
CREATE TYPE "FacultyInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FacultyInvitationDelivery" AS ENUM ('EMAIL', 'LINK');

-- CreateTable
CREATE TABLE "faculty_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(255) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "status" "FacultyInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "delivery_method" "FacultyInvitationDelivery" NOT NULL DEFAULT 'EMAIL',
    "sent_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" VARCHAR(50),
    "delivery_error" VARCHAR(255),
    "invited_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_invitations_pkey" PRIMARY KEY ("id"),
    -- Emails are stored trimmed and lowercased by the API
    CONSTRAINT "faculty_invitations_email_normalized_check" CHECK ("email" = lower(btrim("email"))),
    CONSTRAINT "faculty_invitations_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "faculty_invitations_expiry_check" CHECK ("expires_at" > "created_at")
);

-- CreateIndex
CREATE UNIQUE INDEX "faculty_invitations_token_hash_key" ON "faculty_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "faculty_invitations_email_status_idx" ON "faculty_invitations"("email", "status");

-- CreateIndex
CREATE INDEX "faculty_invitations_status_expires_at_idx" ON "faculty_invitations"("status", "expires_at");

-- At most one outstanding invitation per email, enforced under concurrency.
-- Not modelled in schema.prisma; remove any statement `migrate dev` generates to drop it.
CREATE UNIQUE INDEX "faculty_invitations_one_pending_per_email" ON "faculty_invitations"("email") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "faculty_invitations" ADD CONSTRAINT "faculty_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
