-- Internal BIR Forms module: working forms authored in-portal + their exports.
CREATE TABLE "bir_forms" (
  "id"        UUID NOT NULL,
  "firmId"    UUID NOT NULL,
  "clientId"  UUID NOT NULL,
  "form"      TEXT NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'draft',
  "period"    TEXT NOT NULL DEFAULT '',
  "dataJson"  JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bir_forms_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bir_forms_firmId_idx" ON "bir_forms"("firmId");
CREATE INDEX "bir_forms_clientId_idx" ON "bir_forms"("clientId");
ALTER TABLE "bir_forms" ADD CONSTRAINT "bir_forms_firmId_fkey"
  FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bir_forms" ADD CONSTRAINT "bir_forms_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "bir_form_exports" (
  "id"         UUID NOT NULL,
  "birFormId"  UUID NOT NULL,
  "kind"       TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "filename"   TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bir_form_exports_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bir_form_exports_birFormId_idx" ON "bir_form_exports"("birFormId");
ALTER TABLE "bir_form_exports" ADD CONSTRAINT "bir_form_exports_birFormId_fkey"
  FOREIGN KEY ("birFormId") REFERENCES "bir_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Register the BIRForms permissions and grant them to the built-in firm roles
-- ADDITIVELY (no existing grants touched — so in-app role customizations survive).
INSERT INTO "permissions" ("id", "resource", "action")
SELECT gen_random_uuid(), 'BIRForms', a
FROM (VALUES ('Read'), ('Create'), ('Update'), ('Delete'), ('File')) AS t(a)
ON CONFLICT ("resource", "action") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."resource" = 'BIRForms'
WHERE r."scope" = 'FIRM'
  AND r."name" IN ('Super Admin', 'Manager', 'Accountant')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
