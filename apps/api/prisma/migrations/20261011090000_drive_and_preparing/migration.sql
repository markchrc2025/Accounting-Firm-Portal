-- U14 (D51): receipt photos can stay in Google Drive; every pile is prepared in the
-- background. Additive: four new nullable columns, one with a default, two indexes,
-- and the receipt_scans status check widened by one value. No row is rewritten.

-- A client's Drive folder of receipt photos (only its id and name are kept).
ALTER TABLE "clients" ADD COLUMN "driveFolderId" TEXT;
ALTER TABLE "clients" ADD COLUMN "driveFolderName" TEXT;
-- One folder, one client: a folder can never list for two clients (NULLs are many).
CREATE UNIQUE INDEX "clients_driveFolderId_key" ON "clients"("driveFolderId");

-- What the background step prepares while a pile is "preparing".
ALTER TABLE "receipt_scans" ADD COLUMN "inputJson" JSONB;

-- Where each scanned file came from. Every existing file was uploaded.
ALTER TABLE "receipt_scan_files" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE "receipt_scan_files" ADD COLUMN "driveFileId" TEXT;
CREATE INDEX "receipt_scan_files_clientId_driveFileId_idx" ON "receipt_scan_files"("clientId", "driveFileId");

-- The allowed values, enforced in the database as well as in code.
ALTER TABLE "receipt_scans" DROP CONSTRAINT "receipt_scans_status_check";
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_status_check"
  CHECK ("status" IN ('preparing', 'reading', 'ready', 'failed', 'approved', 'discarded'));
ALTER TABLE "receipt_scan_files" ADD CONSTRAINT "receipt_scan_files_source_check"
  CHECK ("source" IN ('upload', 'drive'));
