-- U3 · a filed BIR form is sealed at the database (D11), carries the taxpayer block
-- it was filed with (D12), and a filed return is corrected by an amendment (D11, D20).
-- Additive: three new columns (two nullable, one with a default), one unique index,
-- one foreign key, two CHECKs and one trigger. No existing row is rewritten.

-- 1) Amendments ---------------------------------------------------------------
-- sequence: 1 for an original, the original's sequence + 1 for each amendment.
ALTER TABLE "bir_forms" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1;
-- amendsId: the filed form this one amends; NULL for an original.
ALTER TABLE "bir_forms" ADD COLUMN "amendsId" UUID;

-- 2) The taxpayer block as it stood at filing (D12) ----------------------------
-- NULL on drafts and on every form filed before U3.
ALTER TABLE "bir_forms" ADD COLUMN "filedSnapshotJson" JSONB;

-- sequence is NOT NULL, so this CHECK never meets a NULL.
ALTER TABLE "bir_forms" ADD CONSTRAINT "bir_forms_sequence_check" CHECK ("sequence" >= 1);

-- One amendment per form: a second correction amends the first amendment. A
-- PostgreSQL unique index treats NULLs as distinct, so every original (NULL) fits.
CREATE UNIQUE INDEX "bir_forms_amendsId_key" ON "bir_forms"("amendsId");
ALTER TABLE "bir_forms" ADD CONSTRAINT "bir_forms_amendsId_fkey"
  FOREIGN KEY ("amendsId") REFERENCES "bir_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- filed <=> filedAt set. "status" is NOT NULL and IS NOT NULL never yields NULL, so
-- the expression is always TRUE or FALSE, never the NULL a CHECK would let through.
-- NOT VALID: enforced on every row written from now on, existing rows not re-checked.
-- Production may hold a form marked filed before 20260724150000 added "filedAt"
-- (filed, NULL); validating would fail this migration, and with it the deploy. Such
-- a row is sealed by the trigger below all the same.
ALTER TABLE "bir_forms" ADD CONSTRAINT "bir_forms_filed_at_check"
  CHECK (("status" = 'filed') = ("filedAt" IS NOT NULL)) NOT VALID;

-- 3) The seal -------------------------------------------------------------------
CREATE FUNCTION "bir_forms_seal"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- A filed form is never modified or deleted: figures, status, filedAt, anything.
  IF OLD."status" = 'filed' THEN
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

CREATE TRIGGER "bir_forms_seal"
  BEFORE UPDATE OR DELETE ON "bir_forms"
  FOR EACH ROW EXECUTE FUNCTION "bir_forms_seal"();
