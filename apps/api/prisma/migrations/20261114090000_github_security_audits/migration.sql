-- PA4 (D68): GitHub links (a pull request or commit that names an issue, one row per issue and url),
-- imported security-audit runs, and the findings (by the skill's fingerprint) that became issues.
-- Three new tables; nothing existing changes.

-- CreateTable
CREATE TABLE "project_github_links" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "issueId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "number" INTEGER,
    "sha" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "merged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_github_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_security_audits" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "runId" TEXT NOT NULL DEFAULT '',
    "commit" TEXT NOT NULL DEFAULT '',
    "profile" TEXT NOT NULL DEFAULT 'standard',
    "scope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "complete" BOOLEAN NOT NULL,
    "incompleteReason" TEXT NOT NULL DEFAULT '',
    "coverage" JSONB NOT NULL DEFAULT '{}',
    "counts" JSONB NOT NULL DEFAULT '{}',
    "outcome" JSONB NOT NULL DEFAULT '{}',
    "rejected" JSONB NOT NULL DEFAULT '[]',
    "importedById" UUID,
    "actorType" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_security_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_security_findings" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "issueId" UUID,
    "lastSeenAuditId" UUID,
    "state" TEXT NOT NULL,
    "severity" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_security_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_github_links_firmId_idx" ON "project_github_links"("firmId");

-- CreateIndex
CREATE INDEX "project_github_links_projectId_idx" ON "project_github_links"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_github_links_issueId_url_key" ON "project_github_links"("issueId", "url");

-- CreateIndex
CREATE INDEX "project_security_audits_firmId_idx" ON "project_security_audits"("firmId");

-- CreateIndex
CREATE INDEX "project_security_audits_projectId_createdAt_idx" ON "project_security_audits"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "project_security_findings_firmId_idx" ON "project_security_findings"("firmId");

-- CreateIndex
CREATE INDEX "project_security_findings_issueId_idx" ON "project_security_findings"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "project_security_findings_projectId_fingerprint_key" ON "project_security_findings"("projectId", "fingerprint");

-- AddForeignKey
ALTER TABLE "project_github_links" ADD CONSTRAINT "project_github_links_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_github_links" ADD CONSTRAINT "project_github_links_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_github_links" ADD CONSTRAINT "project_github_links_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_security_audits" ADD CONSTRAINT "project_security_audits_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_security_audits" ADD CONSTRAINT "project_security_audits_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_security_audits" ADD CONSTRAINT "project_security_audits_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_security_findings" ADD CONSTRAINT "project_security_findings_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_security_findings" ADD CONSTRAINT "project_security_findings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_security_findings" ADD CONSTRAINT "project_security_findings_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_security_findings" ADD CONSTRAINT "project_security_findings_lastSeenAuditId_fkey" FOREIGN KEY ("lastSeenAuditId") REFERENCES "project_security_audits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

