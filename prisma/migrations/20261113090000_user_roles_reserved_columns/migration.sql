-- Reserved, not implemented: no code reads, validates or writes these columns.
ALTER TABLE "user_roles" ADD COLUMN "expires_at" TIMESTAMP(3);
ALTER TABLE "user_roles" ADD COLUMN "scope" VARCHAR(100);
