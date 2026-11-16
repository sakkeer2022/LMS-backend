-- Rollback of 20261113090000_user_roles_reserved_columns. Drops two reserved columns nothing reads or writes.
BEGIN;
ALTER TABLE "user_roles"
DROP COLUMN IF EXISTS "expires_at",
DROP COLUMN IF EXISTS "scope";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261113090000_user_roles_reserved_columns';
COMMIT;
