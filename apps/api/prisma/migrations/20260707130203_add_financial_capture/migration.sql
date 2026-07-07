-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "type" "CategoryType" NOT NULL,
    "name" TEXT NOT NULL,
    "isDeductible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "income_transactions" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "txnDate" DATE NOT NULL,
    "referenceNo" TEXT,
    "customer" TEXT,
    "description" TEXT NOT NULL,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "vatClass" TEXT NOT NULL,
    "saleToGovernment" BOOLEAN NOT NULL DEFAULT false,
    "outputVAT" DECIMAL(18,2),
    "creditableVATWithheld5pct" DECIMAL(18,2),
    "atc" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "income_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_transactions" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "txnDate" DATE NOT NULL,
    "referenceNo" TEXT,
    "vendor" TEXT,
    "description" TEXT NOT NULL,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "inputVATCategory" TEXT,
    "inputVAT" DECIMAL(18,2),
    "isCapitalGood" BOOLEAN NOT NULL DEFAULT false,
    "capitalGoodAcquisitionCost" DECIMAL(18,2),
    "estimatedUsefulLifeMonths" INTEGER,
    "inputTaxAttribution" TEXT,
    "deductible" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_clientId_idx" ON "categories"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_clientId_type_name_key" ON "categories"("clientId", "type", "name");

-- CreateIndex
CREATE INDEX "income_transactions_clientId_txnDate_idx" ON "income_transactions"("clientId", "txnDate");

-- CreateIndex
CREATE INDEX "income_transactions_clientId_vatClass_idx" ON "income_transactions"("clientId", "vatClass");

-- CreateIndex
CREATE INDEX "income_transactions_categoryId_idx" ON "income_transactions"("categoryId");

-- CreateIndex
CREATE INDEX "purchase_transactions_clientId_txnDate_idx" ON "purchase_transactions"("clientId", "txnDate");

-- CreateIndex
CREATE INDEX "purchase_transactions_clientId_inputVATCategory_idx" ON "purchase_transactions"("clientId", "inputVATCategory");

-- CreateIndex
CREATE INDEX "purchase_transactions_categoryId_idx" ON "purchase_transactions"("categoryId");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_transactions" ADD CONSTRAINT "income_transactions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "income_transactions" ADD CONSTRAINT "income_transactions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_transactions" ADD CONSTRAINT "purchase_transactions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_transactions" ADD CONSTRAINT "purchase_transactions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
