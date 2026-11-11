-- PA8 (D70): project details for an accounting firm, recurring projects, project categories.
-- Additive only: nothing is dropped. A project gets a free-text client name, a professional fee, a
-- category and a recurrence; the firm gets its list of categories (seeded below); every generated
-- occurrence of a recurring project is recorded once (unique on the project and the date).

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "categoryId" UUID,
ADD COLUMN     "clientName" VARCHAR(200),
ADD COLUMN     "isRecurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "professionalFee" DECIMAL(18,2),
ADD COLUMN     "recurrenceEnd" DATE,
ADD COLUMN     "recurrenceFrequency" TEXT,
ADD COLUMN     "recurrenceStart" DATE;

-- CreateTable
CREATE TABLE "project_categories" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '#57606a',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "project_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_occurrences" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "occurrenceDate" DATE NOT NULL,
    "issueId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_categories_firmId_idx" ON "project_categories"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "project_categories_firmId_name_key" ON "project_categories"("firmId", "name");

-- CreateIndex
CREATE INDEX "project_occurrences_firmId_idx" ON "project_occurrences"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "project_occurrences_projectId_occurrenceDate_key" ON "project_occurrences"("projectId", "occurrenceDate");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "project_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_categories" ADD CONSTRAINT "project_categories_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_occurrences" ADD CONSTRAINT "project_occurrences_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_occurrences" ADD CONSTRAINT "project_occurrences_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_occurrences" ADD CONSTRAINT "project_occurrences_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The rules the API checks, kept by the database too ------------------------------------------
ALTER TABLE "projects" ADD CONSTRAINT "projects_professionalFee_check"
  CHECK ("professionalFee" IS NULL OR "professionalFee" >= 0);
ALTER TABLE "projects" ADD CONSTRAINT "projects_recurrenceFrequency_check"
  CHECK ("recurrenceFrequency" IS NULL
         OR "recurrenceFrequency" IN ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'));
ALTER TABLE "projects" ADD CONSTRAINT "projects_recurrence_check"
  CHECK (NOT "isRecurring"
         OR ("recurrenceStart" IS NOT NULL AND "recurrenceFrequency" IS NOT NULL
             AND ("recurrenceEnd" IS NULL OR "recurrenceEnd" >= "recurrenceStart")));

-- A project already linked to a client keeps that client's name as its client name ---------------
UPDATE "projects" p SET "clientName" = c."businessName"
FROM "clients" c WHERE p."clientId" = c."id" AND p."clientName" IS NULL;

-- The starting categories, for the firms that exist now (a firm created later gets them the first
-- time it opens Projects) -----------------------------------------------------------------------
INSERT INTO "project_categories" ("id", "firmId", "name", "colour", "order")
SELECT gen_random_uuid(), f."id", t."name", t."colour", t."order"
FROM "firms" f
CROSS JOIN (VALUES ('Business Registration', '#0969da', 0), ('Business Closure', '#cf222e', 1),
                   ('Tax Filing', '#1a7f37', 2), ('Encoding', '#8250df', 3)) AS t("name", "colour", "order")
ON CONFLICT ("firmId", "name") DO NOTHING;
