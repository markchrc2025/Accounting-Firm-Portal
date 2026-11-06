-- U19 (D59) · what the 1601-EQ alphalist needs to know about a payee, on the expense that
-- names it (the payee has no record of its own). Additive: four nullable columns and one
-- CHECK; no existing row is touched. The branch is the existing "vendorBranch".

-- AlterTable
ALTER TABLE "purchase_transactions" ADD COLUMN "payeeKind" TEXT,
ADD COLUMN "payeeLastName" TEXT,
ADD COLUMN "payeeFirstName" TEXT,
ADD COLUMN "payeeMiddleName" TEXT;

-- The kind is one of two words, or not given.
ALTER TABLE "purchase_transactions" ADD CONSTRAINT "purchase_transactions_payeeKind_check"
  CHECK ("payeeKind" IS NULL OR "payeeKind" IN ('individual', 'non_individual'));
