-- CreateTable
CREATE TABLE "bir_filings" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "form" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "figuresJson" JSONB NOT NULL DEFAULT '{}',
    "xmlFilename" TEXT NOT NULL,
    "xmlBase64" TEXT NOT NULL,
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bir_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "input_tax_assets" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "sourceForm" TEXT NOT NULL,
    "asOfYear" INTEGER NOT NULL,
    "asOfQuarter" INTEGER NOT NULL,
    "excessInputTaxCarriedForward" DECIMAL(18,2) NOT NULL,
    "deferredCapitalGoodsInputTax" DECIMAL(18,2) NOT NULL,
    "totalInputTaxAsset" DECIMAL(18,2) NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "input_tax_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bir_filings_clientId_idx" ON "bir_filings"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "bir_filings_clientId_form_periodStart_periodEnd_key" ON "bir_filings"("clientId", "form", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "input_tax_assets_clientId_idx" ON "input_tax_assets"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "input_tax_assets_clientId_sourceForm_asOfYear_asOfQuarter_key" ON "input_tax_assets"("clientId", "sourceForm", "asOfYear", "asOfQuarter");

-- AddForeignKey
ALTER TABLE "bir_filings" ADD CONSTRAINT "bir_filings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "input_tax_assets" ADD CONSTRAINT "input_tax_assets_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
