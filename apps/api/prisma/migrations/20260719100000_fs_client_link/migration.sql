-- Link FS reports to portal clients (validated scalar; entity facts are
-- snapshotted at link time and stay editable on the report).
ALTER TABLE "fs_reports" ADD COLUMN "clientId" UUID;
CREATE INDEX "fs_reports_clientId_idx" ON "fs_reports"("clientId");
