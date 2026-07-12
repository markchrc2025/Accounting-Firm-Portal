-- CoA CRUD: provenance + edit tracking + soft delete. Seeded rows carry
-- source='seed'; the seeder skips rows with editedAt set (user edits win).
ALTER TABLE "chart_accounts"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'custom',
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
-- Rows present before this migration all came from the seed.
UPDATE "chart_accounts" SET "source" = 'seed';

ALTER TABLE "account_tax_mappings"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'custom',
  ADD COLUMN "editedAt" TIMESTAMP(3);
UPDATE "account_tax_mappings" SET "source" = 'seed';
