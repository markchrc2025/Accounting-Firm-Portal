-- PA5 (D69): a work session imported from Sentire Projects whose person has no account in the Portal
-- keeps no user, so a session's user may be empty. Existing rows all have one.

-- AlterTable
ALTER TABLE "project_work_sessions" ALTER COLUMN "userId" DROP NOT NULL;

