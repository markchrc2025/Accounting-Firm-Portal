-- AlterTable
ALTER TABLE "purchase_transactions" ADD COLUMN     "documentType" TEXT,
ADD COLUMN     "importBatchId" UUID,
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "province" TEXT,
ADD COLUMN     "remarks" TEXT,
ADD COLUMN     "sourceFile" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'posted',
ADD COLUMN     "tradeName" TEXT,
ADD COLUMN     "vatClaimable" BOOLEAN,
ADD COLUMN     "vendorBranch" TEXT;

-- CreateIndex
CREATE INDEX "purchase_transactions_clientId_vendorTin_referenceNo_idx" ON "purchase_transactions"("clientId", "vendorTin", "referenceNo");

-- Allowed lifecycle states of an imported expense (U6). Prisma cannot express a
-- CHECK, so it lives here; schema.prisma documents it on the `status` field.
-- NULL coverage: "status" is NOT NULL (above), so the IN-list can never be
-- evaluated against NULL — a NULL status is rejected by the NOT NULL constraint
-- before the CHECK is consulted. The CHECK rejects every non-NULL value outside
-- the list. Existing rows carry the DEFAULT 'posted' and pass.
ALTER TABLE "purchase_transactions"
  ADD CONSTRAINT "purchase_transactions_status_check"
  CHECK ("status" IN ('posted', 'held'));
