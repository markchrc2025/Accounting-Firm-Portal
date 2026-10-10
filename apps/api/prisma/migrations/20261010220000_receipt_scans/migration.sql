-- CreateTable
CREATE TABLE "receipt_scans" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reading',
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "batchId" TEXT,
    "estimatedUsd" DECIMAL(14,6) NOT NULL,
    "actualUsd" DECIMAL(14,6),
    "problem" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "collectingAt" TIMESTAMP(3),

    CONSTRAINT "receipt_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_scan_files" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT,
    "result" TEXT NOT NULL DEFAULT 'pending',
    "problem" TEXT,
    "copyOfFileId" UUID,
    "promptVersion" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "pages" INTEGER,
    "estimatedUsd" DECIMAL(14,6) NOT NULL,
    "inputTokens" INTEGER,
    "cacheWriteTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsd" DECIMAL(14,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_scan_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_scan_rows" (
    "id" UUID NOT NULL,
    "scanId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "cellsJson" JSONB NOT NULL,
    "doubtsJson" JSONB NOT NULL DEFAULT '[]',
    "checkJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_scan_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipt_scans_batchId_key" ON "receipt_scans"("batchId");

-- CreateIndex
CREATE INDEX "receipt_scans_firmId_month_idx" ON "receipt_scans"("firmId", "month");

-- CreateIndex
CREATE INDEX "receipt_scans_clientId_idx" ON "receipt_scans"("clientId");

-- CreateIndex
CREATE INDEX "receipt_scans_status_idx" ON "receipt_scans"("status");

-- CreateIndex
CREATE INDEX "receipt_scan_files_scanId_idx" ON "receipt_scan_files"("scanId");

-- CreateIndex
CREATE INDEX "receipt_scan_files_clientId_sha256_idx" ON "receipt_scan_files"("clientId", "sha256");

-- CreateIndex
CREATE INDEX "receipt_scan_rows_scanId_idx" ON "receipt_scan_rows"("scanId");

-- CreateIndex
CREATE INDEX "receipt_scan_rows_fileId_idx" ON "receipt_scan_rows"("fileId");

-- AddForeignKey
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_scan_files" ADD CONSTRAINT "receipt_scan_files_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "receipt_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_scan_rows" ADD CONSTRAINT "receipt_scan_rows_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "receipt_scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_scan_rows" ADD CONSTRAINT "receipt_scan_rows_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "receipt_scan_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- U11 (D49): the allowed values, enforced in the database as well as in code.
ALTER TABLE "receipt_scans" ADD CONSTRAINT "receipt_scans_status_check"
  CHECK ("status" IN ('reading', 'ready', 'failed', 'approved', 'discarded'));
ALTER TABLE "receipt_scan_files" ADD CONSTRAINT "receipt_scan_files_result_check"
  CHECK ("result" IN ('pending', 'read', 'not-a-receipt', 'unreadable', 'copy-of-another-file', 'failed'));
