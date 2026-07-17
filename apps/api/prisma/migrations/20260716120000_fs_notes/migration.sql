-- Per-report Notes customisation (policy overrides/toggles + custom notes).
CREATE TABLE "fs_notes" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "blockKey" TEXT,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT,
    "body" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fs_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fs_notes_reportId_idx" ON "fs_notes"("reportId");
-- One override row per (report, policy block); custom notes have NULL blockKey,
-- and Postgres allows multiple NULLs, so custom notes are unconstrained.
CREATE UNIQUE INDEX "fs_notes_reportId_blockKey_key" ON "fs_notes"("reportId", "blockKey");

ALTER TABLE "fs_notes" ADD CONSTRAINT "fs_notes_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "fs_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
