-- PA1 (D65) · the Projects module: project management inside the Portal.
-- Additive: ten new tables, their indexes and foreign keys, CHECKs for the closed sets of
-- words, a partial unique index (one default status per firm), two small triggers that keep
-- keys and numbers from ever changing, the starting issue types and statuses for the firms
-- that exist, and the four Projects permissions (granted to Super Admin only). No existing
-- row is touched.

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "repoUrl" TEXT NOT NULL DEFAULT '',
    "liveUrl" TEXT NOT NULL DEFAULT '',
    "deployAppName" TEXT NOT NULL DEFAULT '',
    "parentProjectId" UUID,
    "clientId" UUID,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "issueCounter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_status_updates" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_status_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_types" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '#57606a',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "issue_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_statuses" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '#57606a',
    "order" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "issue_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "typeId" UUID NOT NULL,
    "statusId" UUID NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "assigneeId" UUID,
    "authorId" UUID,
    "milestoneId" UUID,
    "parentIssueId" UUID,
    "startDate" DATE,
    "dueDate" DATE,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labels" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '#0969da',

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_labels" (
    "issueId" UUID NOT NULL,
    "labelId" UUID NOT NULL,
    "firmId" UUID NOT NULL,

    CONSTRAINT "issue_labels_pkey" PRIMARY KEY ("issueId","labelId")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "startDate" DATE,
    "dueDate" DATE,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_comments" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "issueId" UUID NOT NULL,
    "authorId" UUID,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issue_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_activities" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "issueId" UUID,
    "actorType" TEXT NOT NULL,
    "actorUserId" UUID,
    "channel" TEXT NOT NULL,
    "sessionId" UUID,
    "action" TEXT NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_firmId_idx" ON "projects"("firmId");

-- CreateIndex
CREATE INDEX "projects_clientId_idx" ON "projects"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_firmId_key_key" ON "projects"("firmId", "key");

-- CreateIndex
CREATE INDEX "project_status_updates_firmId_idx" ON "project_status_updates"("firmId");

-- CreateIndex
CREATE INDEX "project_status_updates_projectId_createdAt_idx" ON "project_status_updates"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "issue_types_firmId_idx" ON "issue_types"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "issue_types_firmId_name_key" ON "issue_types"("firmId", "name");

-- CreateIndex
CREATE INDEX "issue_statuses_firmId_idx" ON "issue_statuses"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "issue_statuses_firmId_name_key" ON "issue_statuses"("firmId", "name");

-- CreateIndex
CREATE INDEX "issues_firmId_idx" ON "issues"("firmId");

-- CreateIndex
CREATE INDEX "issues_projectId_statusId_idx" ON "issues"("projectId", "statusId");

-- CreateIndex
CREATE INDEX "issues_assigneeId_idx" ON "issues"("assigneeId");

-- CreateIndex
CREATE INDEX "issues_milestoneId_idx" ON "issues"("milestoneId");

-- CreateIndex
CREATE INDEX "issues_parentIssueId_idx" ON "issues"("parentIssueId");

-- CreateIndex
CREATE UNIQUE INDEX "issues_firmId_key_key" ON "issues"("firmId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "issues_projectId_number_key" ON "issues"("projectId", "number");

-- CreateIndex
CREATE INDEX "labels_firmId_idx" ON "labels"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "labels_firmId_name_key" ON "labels"("firmId", "name");

-- CreateIndex
CREATE INDEX "issue_labels_firmId_idx" ON "issue_labels"("firmId");

-- CreateIndex
CREATE INDEX "issue_labels_labelId_idx" ON "issue_labels"("labelId");

-- CreateIndex
CREATE INDEX "milestones_firmId_idx" ON "milestones"("firmId");

-- CreateIndex
CREATE INDEX "milestones_projectId_idx" ON "milestones"("projectId");

-- CreateIndex
CREATE INDEX "issue_comments_firmId_idx" ON "issue_comments"("firmId");

-- CreateIndex
CREATE INDEX "issue_comments_issueId_createdAt_idx" ON "issue_comments"("issueId", "createdAt");

-- CreateIndex
CREATE INDEX "project_activities_firmId_idx" ON "project_activities"("firmId");

-- CreateIndex
CREATE INDEX "project_activities_projectId_createdAt_idx" ON "project_activities"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "project_activities_issueId_createdAt_idx" ON "project_activities"("issueId", "createdAt");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_parentProjectId_fkey" FOREIGN KEY ("parentProjectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_status_updates" ADD CONSTRAINT "project_status_updates_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_status_updates" ADD CONSTRAINT "project_status_updates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_status_updates" ADD CONSTRAINT "project_status_updates_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_types" ADD CONSTRAINT "issue_types_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_statuses" ADD CONSTRAINT "issue_statuses_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "issue_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "issue_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_parentIssueId_fkey" FOREIGN KEY ("parentIssueId") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CHECKs: the closed sets of words ----------------------------------------------------
ALTER TABLE "projects" ADD CONSTRAINT "projects_key_check"
  CHECK ("key" ~ '^[A-Z][A-Z0-9]{1,9}$');
ALTER TABLE "projects" ADD CONSTRAINT "projects_issueCounter_check" CHECK ("issueCounter" >= 0);
ALTER TABLE "project_status_updates" ADD CONSTRAINT "project_status_updates_status_check"
  CHECK ("status" IN ('NOT_STARTED', 'ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'ON_HOLD', 'FINISHED'));
ALTER TABLE "project_status_updates" ADD CONSTRAINT "project_status_updates_actorType_check"
  CHECK ("actorType" IN ('USER', 'CLAUDE', 'GITHUB', 'SYSTEM'));
ALTER TABLE "issue_statuses" ADD CONSTRAINT "issue_statuses_category_check"
  CHECK ("category" IN ('TODO', 'IN_PROGRESS', 'DONE'));
ALTER TABLE "issues" ADD CONSTRAINT "issues_priority_check"
  CHECK ("priority" IN ('LOW', 'NORMAL', 'HIGH', 'URGENT'));
ALTER TABLE "issues" ADD CONSTRAINT "issues_number_check" CHECK ("number" >= 1);
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_state_check"
  CHECK ("state" IN ('OPEN', 'LOCKED', 'CLOSED'));
ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_actorType_check"
  CHECK ("actorType" IN ('USER', 'CLAUDE', 'GITHUB', 'SYSTEM'));
ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_channel_check"
  CHECK ("channel" IN ('web', 'api', 'mcp', 'github', 'system'));

-- At most ONE default issue status per firm (Prisma cannot express a partial index).
CREATE UNIQUE INDEX "issue_statuses_one_default_key"
  ON "issue_statuses"("firmId") WHERE "isDefault";

-- A project's key, and an issue's key, number and project, never change -------------
CREATE FUNCTION "projects_keys_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN
    IF NEW."key" IS DISTINCT FROM OLD."key" OR NEW."firmId" IS DISTINCT FROM OLD."firmId" THEN
      RAISE EXCEPTION 'PROJECT_KEY_FIXED: the key of project % cannot change', OLD."id";
    END IF;
  ELSE
    IF NEW."key" IS DISTINCT FROM OLD."key"
       OR NEW."number" IS DISTINCT FROM OLD."number"
       OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
       OR NEW."firmId" IS DISTINCT FROM OLD."firmId" THEN
      RAISE EXCEPTION 'ISSUE_KEY_FIXED: the key and number of issue % cannot change', OLD."id";
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "projects_keys_immutable" BEFORE UPDATE ON "projects"
  FOR EACH ROW EXECUTE FUNCTION "projects_keys_immutable"();
CREATE TRIGGER "issues_keys_immutable" BEFORE UPDATE ON "issues"
  FOR EACH ROW EXECUTE FUNCTION "projects_keys_immutable"();

-- The starting issue types and statuses, for the firms that exist now (a firm created
-- later gets them the first time it opens Projects) ---------------------------------
INSERT INTO "issue_types" ("id", "firmId", "name", "colour", "order")
SELECT gen_random_uuid(), f."id", t."name", t."colour", t."order"
FROM "firms" f
CROSS JOIN (VALUES ('Task', '#57606a', 0), ('Bug', '#cf222e', 1),
                   ('Feature', '#1a7f37', 2), ('Epic', '#8250df', 3)) AS t("name", "colour", "order")
ON CONFLICT ("firmId", "name") DO NOTHING;

INSERT INTO "issue_statuses" ("id", "firmId", "name", "colour", "order", "category", "isDefault")
SELECT gen_random_uuid(), f."id", s."name", s."colour", s."order", s."category", s."isDefault"
FROM "firms" f
CROSS JOIN (VALUES ('New', '#57606a', 0, 'TODO', true),
                   ('In progress', '#bf8700', 1, 'IN_PROGRESS', false),
                   ('Blocked', '#cf222e', 2, 'IN_PROGRESS', false),
                   ('In review', '#8250df', 3, 'IN_PROGRESS', false),
                   ('Done', '#1a7f37', 4, 'DONE', false),
                   ('Won''t do', '#6e7781', 5, 'DONE', false))
     AS s("name", "colour", "order", "category", "isDefault")
ON CONFLICT ("firmId", "name") DO NOTHING;

-- The Projects permissions, granted ADDITIVELY to Super Admin only; the owner gives them to
-- other roles in the role editor.
INSERT INTO "permissions" ("id", "resource", "action")
SELECT gen_random_uuid(), 'Projects', a
FROM (VALUES ('Read'), ('Create'), ('Update'), ('Configure')) AS t(a)
ON CONFLICT ("resource", "action") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."resource" = 'Projects'
WHERE r."scope" = 'FIRM' AND r."name" = 'Super Admin'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
