-- Default catalog service per client: seeds the New-billing line items
-- (rate = the client's professionalFee, falling back to the service fee).
ALTER TABLE "clients" ADD COLUMN "defaultServiceId" UUID;
ALTER TABLE "clients"
  ADD CONSTRAINT "clients_defaultServiceId_fkey"
  FOREIGN KEY ("defaultServiceId") REFERENCES "services"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "clients_defaultServiceId_idx" ON "clients"("defaultServiceId");
