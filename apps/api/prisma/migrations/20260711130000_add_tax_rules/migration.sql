-- CreateTable
CREATE TABLE "tax_rules" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "flatRate" DECIMAL(6,3),
    "bracketsJson" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_rules_clientId_key" ON "tax_rules"("clientId");

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
