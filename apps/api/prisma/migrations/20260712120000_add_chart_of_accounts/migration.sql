-- PH SME Chart of Accounts + BIR income-tax mapping (global reference data,
-- seeded from the xlsx files under prisma/data/).
CREATE TABLE "chart_accounts" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "parentCode" TEXT,
    "normalBalance" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "lockDate" DATE,
    "monthlyMovement" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    CONSTRAINT "chart_accounts_pkey" PRIMARY KEY ("code")
);

CREATE INDEX "chart_accounts_class_idx" ON "chart_accounts"("class");
CREATE INDEX "chart_accounts_parentCode_idx" ON "chart_accounts"("parentCode");

CREATE TABLE "account_tax_mappings" (
    "accountCode" TEXT NOT NULL,
    "taxCategory" TEXT NOT NULL DEFAULT 'Regular',
    "accountName" TEXT NOT NULL,
    "taxReturnLine" TEXT,
    CONSTRAINT "account_tax_mappings_pkey" PRIMARY KEY ("accountCode", "taxCategory")
);
