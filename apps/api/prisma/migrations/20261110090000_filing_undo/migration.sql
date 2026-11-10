-- U22 (D63) · taking back a filing that was made without the BIR's confirmation e-mail.
-- Additive: one new table (the history), one function (the only way back) and a new body
-- for the seal trigger function that opens ONE transition under exact conditions. The
-- trigger itself, the table bir_forms and every existing row are untouched.

-- 1) The history of a filing taken back ---------------------------------------------
CREATE TABLE "bir_form_filing_undos" (
    "id" UUID NOT NULL,
    "firmId" UUID NOT NULL,
    "birFormId" UUID NOT NULL,
    "confirmationId" UUID,
    "filedAt" TIMESTAMP(3) NOT NULL,
    "filedSnapshotJson" JSONB,
    "overrideReason" TEXT,
    "undoneByUserId" UUID,
    "undoneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,

    CONSTRAINT "bir_form_filing_undos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bir_form_filing_undos_birFormId_idx" ON "bir_form_filing_undos"("birFormId");

ALTER TABLE "bir_form_filing_undos" ADD CONSTRAINT "bir_form_filing_undos_firmId_fkey"
  FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- NO ACTION: a return with history cannot be deleted; a firm's whole delete still works
-- (everything goes in one statement).
ALTER TABLE "bir_form_filing_undos" ADD CONSTRAINT "bir_form_filing_undos_birFormId_fkey"
  FOREIGN KEY ("birFormId") REFERENCES "bir_forms"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "bir_form_filing_undos" ADD CONSTRAINT "bir_form_filing_undos_confirmationId_fkey"
  FOREIGN KEY ("confirmationId") REFERENCES "bir_form_confirmations"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "bir_form_filing_undos" ADD CONSTRAINT "bir_form_filing_undos_undoneByUserId_fkey"
  FOREIGN KEY ("undoneByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bir_form_filing_undos" ADD CONSTRAINT "bir_form_filing_undos_reason_check"
  CHECK (char_length(btrim("reason")) >= 10);

-- 2) The seal: one narrow exception --------------------------------------------------
-- A filed form is still never modified or deleted, EXCEPT by the one transition
-- filed -> draft that bir_form_undo_filing() makes, and only when ALL of these hold:
--   * the flag portal.bir_form_undo (transaction-local) names this very form;
--   * the row becomes a draft with no filedAt and no snapshot, and nothing else about it
--     changes (data, form, period, client, sequence, amendment link, ...);
--   * its live confirmation is an override, and no BIR e-mail was ever attached to it;
--   * nothing amends it;
--   * the history row of exactly this filing (same date, same snapshot) exists already.
-- Every other change to a filed row, and every delete, raises BIR_FORM_SEALED as before.
CREATE OR REPLACE FUNCTION "bir_forms_seal"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'filed' THEN
    IF TG_OP = 'UPDATE'
       AND current_setting('portal.bir_form_undo', true) = OLD."id"::text
       AND NEW."status" = 'draft'
       AND NEW."filedAt" IS NULL
       AND NEW."filedSnapshotJson" IS NULL
       AND (to_jsonb(NEW) - 'status' - 'filedAt' - 'filedSnapshotJson' - 'updatedAt')
         = (to_jsonb(OLD) - 'status' - 'filedAt' - 'filedSnapshotJson' - 'updatedAt')
       AND EXISTS (
         SELECT 1 FROM "bir_form_confirmations" c
         WHERE c."birFormId" = OLD."id" AND c."supersededAt" IS NULL AND c."kind" = 'override')
       AND NOT EXISTS (
         SELECT 1 FROM "bir_form_confirmations" c
         WHERE c."birFormId" = OLD."id" AND c."kind" = 'bir_email')
       AND NOT EXISTS (SELECT 1 FROM "bir_forms" a WHERE a."amendsId" = OLD."id")
       AND EXISTS (
         SELECT 1 FROM "bir_form_filing_undos" u
         WHERE u."birFormId" = OLD."id"
           AND u."filedAt" IS NOT DISTINCT FROM OLD."filedAt"
           AND u."filedSnapshotJson" IS NOT DISTINCT FROM OLD."filedSnapshotJson")
    THEN
      RETURN NEW;
    END IF;
    -- A filed form is never modified or deleted: figures, status, filedAt, anything.
    RAISE EXCEPTION 'BIR_FORM_SEALED: % of filed BIR form % refused', TG_OP, OLD."id"
      USING HINT = 'Correct a filed return with an amendment; a certificate by issuing a new one.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  -- filedAt, once set, never changes and is never cleared (NULL -> value is the filing).
  IF OLD."filedAt" IS NOT NULL AND NEW."filedAt" IS DISTINCT FROM OLD."filedAt" THEN
    RAISE EXCEPTION 'BIR_FORM_SEALED: filedAt of BIR form % cannot change once set', OLD."id";
  END IF;
  -- An amendment stays the amendment of the same form (a unique index is not immutability).
  IF OLD."amendsId" IS NOT NULL AND NEW."amendsId" IS DISTINCT FROM OLD."amendsId" THEN
    RAISE EXCEPTION 'BIR_FORM_SEALED: amendsId of BIR form % cannot change once set', OLD."id";
  END IF;
  RETURN NEW;
END;
$$;

-- 3) The one way back ------------------------------------------------------------------
-- Checks the conditions itself (the Portal checks them first, to answer in words), writes
-- the history, opens the exception for this one statement, supersedes the override row.
-- All in the caller's transaction. Returns the history row's id.
CREATE FUNCTION "bir_form_undo_filing"(
  p_form_id UUID, p_firm_id UUID, p_user_id UUID, p_reason TEXT
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  f RECORD;
  c RECORD;
  h UUID;
BEGIN
  SELECT * INTO f FROM "bir_forms" WHERE "id" = p_form_id AND "firmId" = p_firm_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BIR_UNDO_REFUSED: BIR form % was not found', p_form_id;
  END IF;
  IF f."status" <> 'filed' THEN
    RAISE EXCEPTION 'BIR_UNDO_REFUSED: BIR form % is not filed', p_form_id;
  END IF;
  IF p_reason IS NULL OR char_length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'BIR_UNDO_REFUSED: the reason is shorter than 10 characters';
  END IF;
  SELECT * INTO c FROM "bir_form_confirmations"
    WHERE "birFormId" = f."id" AND "supersededAt" IS NULL FOR UPDATE;
  IF NOT FOUND OR c."kind" <> 'override' THEN
    RAISE EXCEPTION 'BIR_UNDO_REFUSED: the filing of BIR form % does not rest on an override', p_form_id;
  END IF;
  IF EXISTS (SELECT 1 FROM "bir_form_confirmations" WHERE "birFormId" = f."id" AND "kind" = 'bir_email') THEN
    RAISE EXCEPTION 'BIR_UNDO_REFUSED: a BIR e-mail was attached to BIR form %', p_form_id;
  END IF;
  IF EXISTS (SELECT 1 FROM "bir_forms" WHERE "amendsId" = f."id") THEN
    RAISE EXCEPTION 'BIR_UNDO_REFUSED: BIR form % has an amendment', p_form_id;
  END IF;

  h := gen_random_uuid();
  INSERT INTO "bir_form_filing_undos"
    ("id", "firmId", "birFormId", "confirmationId", "filedAt", "filedSnapshotJson",
     "overrideReason", "undoneByUserId", "reason")
  VALUES
    (h, f."firmId", f."id", c."id", f."filedAt", f."filedSnapshotJson",
     c."overrideReason", p_user_id, btrim(p_reason));

  PERFORM set_config('portal.bir_form_undo', f."id"::text, true);
  UPDATE "bir_forms"
    SET "status" = 'draft', "filedAt" = NULL, "filedSnapshotJson" = NULL, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = f."id";
  PERFORM set_config('portal.bir_form_undo', '', true);

  UPDATE "bir_form_confirmations" SET "supersededAt" = CURRENT_TIMESTAMP WHERE "id" = c."id";
  RETURN h;
END;
$$;
