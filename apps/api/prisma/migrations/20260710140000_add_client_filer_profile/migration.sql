-- CreateEnum
CREATE TYPE "BillingMethod" AS ENUM ('QUARTERLY', 'MONTHLY', 'AS_FILING');

-- AlterTable
ALTER TABLE "clients"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'non-individual',
  ADD COLUMN "regName" TEXT,
  ADD COLUMN "lastName" TEXT,
  ADD COLUMN "firstName" TEXT,
  ADD COLUMN "middleName" TEXT,
  ADD COLUMN "tradeName" TEXT,
  ADD COLUMN "branch" TEXT NOT NULL DEFAULT '00000',
  ADD COLUMN "rdo" TEXT,
  ADD COLUMN "rdoName" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "zip" TEXT,
  ADD COLUMN "birthdate" DATE,
  ADD COLUMN "incorpDate" DATE,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "citizenship" TEXT,
  ADD COLUMN "civilStatus" TEXT,
  ADD COLUMN "taxpayerType" TEXT,
  ADD COLUMN "classification" TEXT,
  ADD COLUMN "taxTypesJson" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "professionalFee" DECIMAL(18,2),
  ADD COLUMN "billingMethod" "BillingMethod" NOT NULL DEFAULT 'AS_FILING';
