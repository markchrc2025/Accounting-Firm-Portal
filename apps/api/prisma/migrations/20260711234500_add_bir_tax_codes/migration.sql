-- BIR tax-code reference data (global national codes).
CREATE TABLE "bir_tax_types" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "forms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    CONSTRAINT "bir_tax_types_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "bir_atc_codes" (
    "atc" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "taxTypeCode" TEXT NOT NULL,
    "payeeType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "condition" TEXT,
    "rate" DECIMAL(12,6),
    "rateBasis" TEXT,
    "thresholdAmount" DECIMAL(18,2),
    "bracket" TEXT,
    "forms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "certificate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    CONSTRAINT "bir_atc_codes_pkey" PRIMARY KEY ("atc")
);

CREATE INDEX "bir_atc_codes_classification_idx" ON "bir_atc_codes"("classification");
CREATE INDEX "bir_atc_codes_taxTypeCode_idx" ON "bir_atc_codes"("taxTypeCode");
CREATE INDEX "bir_atc_codes_status_idx" ON "bir_atc_codes"("status");
