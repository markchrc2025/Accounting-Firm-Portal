-- PA3 (D67): personal API tokens (only the SHA-256 of a token is stored) and Claude work sessions
-- for the Projects module. project_activities.sessionId was added in PA1 without a foreign key and
-- every existing value is NULL, so the new key cannot fail.

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_work_sessions" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenId" UUID,
    "client" TEXT NOT NULL DEFAULT 'claude-code',
    "title" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "summary" TEXT NOT NULL DEFAULT '',
    "nextSteps" TEXT NOT NULL DEFAULT '',
    "issueKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "project_work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_tokenHash_key" ON "api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "api_tokens_firmId_idx" ON "api_tokens"("firmId");

-- CreateIndex
CREATE INDEX "api_tokens_userId_createdAt_idx" ON "api_tokens"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "project_work_sessions_firmId_idx" ON "project_work_sessions"("firmId");

-- CreateIndex
CREATE INDEX "project_work_sessions_projectId_startedAt_idx" ON "project_work_sessions"("projectId", "startedAt");

-- CreateIndex
CREATE INDEX "project_work_sessions_userId_idx" ON "project_work_sessions"("userId");

-- AddForeignKey
ALTER TABLE "project_activities" ADD CONSTRAINT "project_activities_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "project_work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_work_sessions" ADD CONSTRAINT "project_work_sessions_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_work_sessions" ADD CONSTRAINT "project_work_sessions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_work_sessions" ADD CONSTRAINT "project_work_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_work_sessions" ADD CONSTRAINT "project_work_sessions_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "api_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

