-- Per-report toggle for generating Notes to Financial Statements.
ALTER TABLE "fs_reports" ADD COLUMN "includeNotes" BOOLEAN NOT NULL DEFAULT true;
