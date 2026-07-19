-- Sub-Clients: billing-only parent link. A sub-client's invoices are recorded
-- under its main client (the payer); billedForClientId keeps the provenance.
ALTER TABLE "clients" ADD COLUMN "billingParentId" UUID;
CREATE INDEX "clients_billingParentId_idx" ON "clients"("billingParentId");

ALTER TABLE "invoices" ADD COLUMN "billedForClientId" UUID;
CREATE INDEX "invoices_billedForClientId_idx" ON "invoices"("billedForClientId");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billedForClientId_fkey"
  FOREIGN KEY ("billedForClientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
