-- Branch offices for a client (same TIN, distinct branch codes).
ALTER TABLE "clients" ADD COLUMN "hasBranches" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "clients" ADD COLUMN "branchesJson" JSONB NOT NULL DEFAULT '[]';
