-- Distinguish seed-provided ("system") roles from custom ones created in-app.
-- Existing seeded roles are flagged system immediately so they can't be renamed
-- or deleted before the next db:seed run.
ALTER TABLE "roles" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;
UPDATE "roles" SET "isSystem" = true
WHERE "name" IN (
  'Super Admin', 'Manager', 'Accountant', 'Staff', 'Auditor',
  'Client Owner', 'Client Manager', 'Client Viewer'
);
