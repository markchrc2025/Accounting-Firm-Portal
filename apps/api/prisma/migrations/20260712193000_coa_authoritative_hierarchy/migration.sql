-- Non-postable group headers now share the chart_accounts table.
ALTER TABLE "chart_accounts" ADD COLUMN "postable" BOOLEAN NOT NULL DEFAULT true;

-- The old parentCode values were inferred from the 4-digit code prefix, which
-- invented phantom parents and mis-parented the cross-prefix contra accounts.
-- Reset them: the seed repopulates every untouched row's parent verbatim from
-- CoA_Hierarchy.xlsx on deploy, so no stale/unresolved parent can linger and
-- block CRUD writes (which re-validate parent referential integrity). Rows a
-- user edited in-app become top-level (NULL) rather than keeping a bad parent.
UPDATE "chart_accounts" SET "parentCode" = NULL;
