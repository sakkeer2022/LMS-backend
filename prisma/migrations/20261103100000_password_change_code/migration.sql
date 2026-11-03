-- A code emailed to a signed-in account before it changes its password. It has its own purpose so it can
-- never be used to recover a password, and a recovery code can never be used to change one.
-- AlterEnum
ALTER TYPE "ChallengePurpose" ADD VALUE 'PASSWORD_CHANGE';
