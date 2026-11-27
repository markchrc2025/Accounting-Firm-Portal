-- U27 (D74): a filing of the nine returns made before the confirmation rule (U18) has no
-- confirmation row at all. Its filing may be taken back exactly as an override's (D63): the
-- seal's one exception and bir_form_undo_filing() accept it, and nothing else changes. The
-- 1601-C, the 2307 and the 2316 are filed without a confirmation by design and are never
-- taken back. A return with a BIR e-mail, ever, is still never undone.

CREATE OR REPLACE FUNCTION "bir_form_filed_unconfirmed"(p_form_id UUID, p_form TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT p_form IN ('2550Q', '2551Q', '1701Q', '1701', '1701A', '1702Q', '1702RT', '0619E', '1601EQ')
     AND NOT EXISTS (SELECT 1 FROM "bir_form_confirmations" c WHERE c."birFormId" = p_form_id);
$$;

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
       AND (
         EXISTS (
           SELECT 1 FROM "bir_form_confirmations" c
           WHERE c."birFormId" = OLD."id" AND c."supersededAt" IS NULL AND c."kind" = 'override')
         OR "bir_form_filed_unconfirmed"(OLD."id", OLD."form"))
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

CREATE OR REPLACE FUNCTION "bir_form_undo_filing"(
  p_form_id UUID, p_firm_id UUID, p_user_id UUID, p_reason TEXT
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  f RECORD;
  c RECORD;
  has_c BOOLEAN;
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
  has_c := FOUND;
  IF has_c AND c."kind" <> 'override' THEN
    RAISE EXCEPTION 'BIR_UNDO_REFUSED: the filing of BIR form % does not rest on an override', p_form_id;
  END IF;
  IF NOT has_c AND NOT "bir_form_filed_unconfirmed"(f."id", f."form") THEN
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
    (h, f."firmId", f."id", CASE WHEN has_c THEN c."id" END, f."filedAt", f."filedSnapshotJson",
     CASE WHEN has_c THEN c."overrideReason" END, p_user_id, btrim(p_reason));

  PERFORM set_config('portal.bir_form_undo', f."id"::text, true);
  UPDATE "bir_forms"
    SET "status" = 'draft', "filedAt" = NULL, "filedSnapshotJson" = NULL, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = f."id";
  PERFORM set_config('portal.bir_form_undo', '', true);

  IF has_c THEN
    UPDATE "bir_form_confirmations" SET "supersededAt" = CURRENT_TIMESTAMP WHERE "id" = c."id";
  END IF;
  RETURN h;
END;
$$;
