-- U18 (D58) · the BIR's confirmation e-mail for a filed return, kept in its own table.
-- Additive: one new table, its indexes and three foreign keys. No existing row is
-- touched, and the trigger bir_forms_seal is NOT touched: a confirmation is written
-- beside a sealed return, never into it.

-- CreateTable
CREATE TABLE "bir_form_confirmations" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "birFormId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT,
    "originalFilename" TEXT,
    "sha256" TEXT,
    "birFileName" TEXT,
    "tinWithBranch" TEXT,
    "formCode" TEXT,
    "taxYear" INTEGER,
    "quarter" INTEGER,
    "fyEndMonth" INTEGER,
    "receivedAt" TIMESTAMP(3),
    "uploadedByUserId" UUID,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overrideReason" TEXT,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "bir_form_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bir_form_confirmations_birFormId_idx" ON "bir_form_confirmations"("birFormId");

-- CreateIndex
CREATE UNIQUE INDEX "bir_form_confirmations_firmId_sha256_key" ON "bir_form_confirmations"("firmId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "bir_form_confirmations_firmId_birFileName_receivedAt_key" ON "bir_form_confirmations"("firmId", "birFileName", "receivedAt");

-- AddForeignKey
ALTER TABLE "bir_form_confirmations" ADD CONSTRAINT "bir_form_confirmations_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bir_form_confirmations" ADD CONSTRAINT "bir_form_confirmations_birFormId_fkey" FOREIGN KEY ("birFormId") REFERENCES "bir_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bir_form_confirmations" ADD CONSTRAINT "bir_form_confirmations_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most ONE active confirmation per return. Prisma cannot express a partial index,
-- so it lives here; a replaced row (supersededAt set) is kept and does not count.
CREATE UNIQUE INDEX "bir_form_confirmations_one_active_key"
  ON "bir_form_confirmations"("birFormId") WHERE "supersededAt" IS NULL;

-- The kind is one of two words.
ALTER TABLE "bir_form_confirmations" ADD CONSTRAINT "bir_form_confirmations_kind_check"
  CHECK ("kind" IN ('bir_email', 'override'));
