-- Invoice/bill line-item metadata on transactions (additive; netAmount stays
-- the authoritative aggregated figure).
ALTER TABLE "income_transactions"
  ADD COLUMN "customerTin" TEXT,
  ADD COLUMN "dueDate" DATE,
  ADD COLUMN "terms" TEXT,
  ADD COLUMN "account" TEXT,
  ADD COLUMN "unit" TEXT,
  ADD COLUMN "quantity" DECIMAL(18,4),
  ADD COLUMN "unitPrice" DECIMAL(18,2),
  ADD COLUMN "discount" DECIMAL(18,2);

ALTER TABLE "purchase_transactions"
  ADD COLUMN "vendorTin" TEXT,
  ADD COLUMN "dueDate" DATE,
  ADD COLUMN "account" TEXT,
  ADD COLUMN "atc" TEXT,
  ADD COLUMN "taxAmount" DECIMAL(18,2),
  ADD COLUMN "unit" TEXT,
  ADD COLUMN "quantity" DECIMAL(18,4),
  ADD COLUMN "unitPrice" DECIMAL(18,2),
  ADD COLUMN "discount" DECIMAL(18,2);
