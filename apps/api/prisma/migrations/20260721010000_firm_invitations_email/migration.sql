-- Firm-staff invitations + invite-email delivery tracking.
-- CLIENT seat invites keep clientId; FIRM staff invites use firmId instead.
ALTER TABLE "invitations" ALTER COLUMN "clientId" DROP NOT NULL;
ALTER TABLE "invitations" ADD COLUMN "firmId" UUID;
ALTER TABLE "invitations" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'CLIENT';
ALTER TABLE "invitations" ADD COLUMN "emailStatus" TEXT;
ALTER TABLE "invitations" ADD COLUMN "emailMessageId" TEXT;
ALTER TABLE "invitations" ADD COLUMN "emailError" TEXT;
ALTER TABLE "invitations" ADD COLUMN "invitedByName" TEXT;

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_firmId_fkey"
  FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "invitations_firmId_idx" ON "invitations"("firmId");

-- Backfill: existing (client-seat) invitations inherit their client's firm.
UPDATE "invitations" i SET "firmId" = c."firmId"
FROM "clients" c WHERE i."clientId" = c."id";
