/**
 * track-a-seal.db-spec.ts — the filed BIR form is sealed AT THE DATABASE (U3, D11).
 *
 * Every assertion here is about PostgreSQL itself, not the service: the writes go
 * through Prisma or raw SQL straight at bir_forms, and every read-back goes through
 * a second, freshly connected PrismaClient so no connection state can satisfy it.
 *
 *   T1  an UPDATE of a filed form is rejected by the database
 *   T2  what the trigger permits and refuses, row unchanged after every refusal
 *   T4  the CHECKs and the UNIQUE index, with explicit NULL coverage
 *
 * The database is truncated before each test (R12) and each test seeds only what
 * it needs: one invented firm, one invented client, the forms it is about.
 *
 * Needs a local PostgreSQL on DATABASE_URL:  bash scripts/local-db.sh
 * Run with:                                  pnpm --filter api test:db
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../../src/app.module";
import { BirFormsService } from "../../src/bir-forms/bir-forms.service";
import type { AuthUser } from "../../src/common/auth/auth-user";
import { tablesToTruncate, truncateAll, truncateBeforeEach } from "./helpers/truncate";

const SEALED = /BIR_FORM_SEALED/;
const TAG = "track-a-seal";

describe("U3 · the seal at the database (bir_forms)", () => {
  truncateBeforeEach();

  let writer: PrismaClient;
  let reader: PrismaClient;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set. Run `bash scripts/local-db.sh` first (see docs/LOCAL-DB.md).",
      );
    }
    writer = new PrismaClient();
  });
  beforeEach(() => {
    reader = new PrismaClient(); // a fresh connection for every test's read-backs
  });
  afterEach(async () => {
    await reader.$disconnect();
  });
  afterAll(async () => {
    await writer.$disconnect();
  });

  async function seedClient(): Promise<{ firmId: string; clientId: string }> {
    const firm = await writer.firm.create({ data: { name: `${TAG} firm` } });
    const client = await writer.client.create({
      data: {
        firmId: firm.id,
        businessName: `${TAG} Trading Co`,
        tin: "000111222",
        taxType: "PERCENTAGE",
      },
    });
    return { firmId: firm.id, clientId: client.id };
  }

  async function seedForm(
    status: "draft" | "filed",
    form = "2551Q",
  ): Promise<{ id: string; firmId: string; clientId: string }> {
    const { firmId, clientId } = await seedClient();
    const f = await writer.birForm.create({
      data: {
        firmId,
        clientId,
        form,
        period: "2026-Q2",
        status,
        filedAt: status === "filed" ? new Date("2026-07-20T02:00:00.000Z") : null,
        dataJson: { rows: [{ atc: "PT010", taxable: "100000" }] },
      },
    });
    return { id: f.id, firmId, clientId };
  }

  /** The whole row as JSON, read through the fresh client — every column, new ones included. */
  async function rowJson(id: string): Promise<unknown> {
    const rows = await reader.$queryRawUnsafe<Array<{ r: unknown }>>(
      `SELECT to_jsonb(b) AS r FROM bir_forms b WHERE b.id = $1::uuid`,
      id,
    );
    return rows[0]?.r ?? null;
  }

  // -------------------------------------------------------------------------
  // T1
  // -------------------------------------------------------------------------

  it("T1: an UPDATE of a filed form is rejected by the database", async () => {
    const { id } = await seedForm("filed");
    const before = await rowJson(id);
    await expect(
      writer.birForm.update({ where: { id }, data: { dataJson: { tampered: true } } }),
    ).rejects.toThrow(SEALED);
    expect(await rowJson(id)).toEqual(before);
  });

  // -------------------------------------------------------------------------
  // T2
  // -------------------------------------------------------------------------

  it("T2: draft → filed is permitted, and filedAt is set", async () => {
    const { id } = await seedForm("draft");
    await writer.birForm.update({
      where: { id },
      data: { status: "filed", filedAt: new Date("2026-07-21T03:00:00.000Z") },
    });
    const back = await reader.birForm.findUniqueOrThrow({ where: { id } });
    expect(back.status).toBe("filed");
    expect(back.filedAt?.toISOString()).toBe("2026-07-21T03:00:00.000Z");
  });

  it.each([
    [
      "a dataJson change (raw SQL, not through Prisma)",
      `UPDATE bir_forms SET "dataJson" = '{"tampered": true}'::jsonb WHERE id = $1::uuid`,
    ],
    ["status → draft", `UPDATE bir_forms SET status = 'draft' WHERE id = $1::uuid`],
    ["filedAt → NULL", `UPDATE bir_forms SET "filedAt" = NULL WHERE id = $1::uuid`],
    [
      "filedAt → another value",
      `UPDATE bir_forms SET "filedAt" = '2027-01-01T00:00:00Z' WHERE id = $1::uuid`,
    ],
    [
      "status → draft and filedAt → NULL together (the old Reopen)",
      `UPDATE bir_forms SET status = 'draft', "filedAt" = NULL WHERE id = $1::uuid`,
    ],
    [
      "a no-op touch of updatedAt only",
      `UPDATE bir_forms SET "updatedAt" = now() WHERE id = $1::uuid`,
    ],
  ])(
    "T2: a filed form rejects %s, by a database error, and the row is unchanged",
    async (_what, sql) => {
      const { id } = await seedForm("filed");
      const before = await rowJson(id);
      await expect(writer.$executeRawUnsafe(sql, id)).rejects.toThrow(SEALED);
      expect(await rowJson(id)).toEqual(before);
    },
  );

  it("T2: DELETE of a filed form is rejected and the row is still there", async () => {
    const { id } = await seedForm("filed");
    const before = await rowJson(id);
    await expect(writer.birForm.delete({ where: { id } })).rejects.toThrow(SEALED);
    expect(await rowJson(id)).toEqual(before);
  });

  it("T2: deleting the Client that owns a filed form is rejected (the cascade hits the seal); client and form remain", async () => {
    const { id, clientId } = await seedForm("filed");
    await expect(writer.client.delete({ where: { id: clientId } })).rejects.toThrow(
      SEALED,
    );
    expect(await reader.client.findUnique({ where: { id: clientId } })).not.toBeNull();
    expect(await reader.birForm.findUnique({ where: { id } })).not.toBeNull();
  });

  it("T2: deleting the Firm that owns a filed form is rejected too", async () => {
    const { id, firmId } = await seedForm("filed");
    await expect(writer.firm.delete({ where: { id: firmId } })).rejects.toThrow(SEALED);
    expect(await reader.birForm.findUnique({ where: { id } })).not.toBeNull();
  });

  it("T2: a draft is still updatable and deletable", async () => {
    const { id } = await seedForm("draft");
    await writer.birForm.update({
      where: { id },
      data: { dataJson: { rows: [], edited: true }, period: "2026-Q3" },
    });
    const back = await reader.birForm.findUniqueOrThrow({ where: { id } });
    expect(back.dataJson).toEqual({ rows: [], edited: true });
    expect(back.period).toBe("2026-Q3");
    await writer.birForm.delete({ where: { id } });
    expect(await reader.birForm.findUnique({ where: { id } })).toBeNull();
  });

  it("T2: deleting a client that owns only drafts still cascades to them", async () => {
    const { id, clientId } = await seedForm("draft");
    await writer.client.delete({ where: { id: clientId } });
    expect(await reader.birForm.findUnique({ where: { id } })).toBeNull();
  });

  it("T2: an amendment's amendsId is permanent once set — NULL → value permitted; value → another value and value → NULL rejected", async () => {
    const a = await seedForm("filed");
    const b = await seedForm("filed");
    const d = await seedForm("draft");
    await writer.$executeRawUnsafe(
      `UPDATE bir_forms SET "amendsId" = $2::uuid WHERE id = $1::uuid`,
      d.id,
      a.id,
    );
    const set = await rowJson(d.id);
    expect((set as { amendsId: string }).amendsId).toBe(a.id);
    await expect(
      writer.$executeRawUnsafe(
        `UPDATE bir_forms SET "amendsId" = $2::uuid WHERE id = $1::uuid`,
        d.id,
        b.id,
      ),
    ).rejects.toThrow(SEALED);
    await expect(
      writer.$executeRawUnsafe(
        `UPDATE bir_forms SET "amendsId" = NULL WHERE id = $1::uuid`,
        d.id,
      ),
    ).rejects.toThrow(SEALED);
    expect(await rowJson(d.id)).toEqual(set);
  });

  it("T2: the helper leaves _prisma_migrations intact and every other table empty", async () => {
    await seedForm("filed");
    const migrationDirs = readdirSync(
      join(__dirname, "..", "..", "prisma", "migrations"),
      { withFileTypes: true },
    ).filter((e) => e.isDirectory() && /^\d{14}_/.test(e.name)).length;
    const count = async (t: string) =>
      Number(
        (
          await reader.$queryRawUnsafe<Array<{ n: number }>>(
            `SELECT count(*)::int AS n FROM "${t}"`,
          )
        )[0]?.n,
      );

    const truncated = await truncateAll(writer);

    expect(truncated).not.toContain("_prisma_migrations");
    expect(truncated).toContain("bir_forms");
    expect(await count("_prisma_migrations")).toBe(migrationDirs);
    // Independent of the helper's own pg_class query: information_schema's list.
    const others = (
      await reader.$queryRawUnsafe<Array<{ t: string }>>(
        `SELECT table_name AS t FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`,
      )
    ).map((r) => r.t);
    expect(others.sort()).toEqual([...truncated].sort());
    expect((await tablesToTruncate(reader)).sort()).toEqual(others.sort());
    for (const t of others) expect(`${t}=${await count(t)}`).toBe(`${t}=0`);
  });

  it("T2/T4: NOT VALID — rows the old schema allowed survive the CHECK, the trigger seals the filed one, and a set filedAt cannot change even on a non-filed row", async () => {
    const valid = await reader.$queryRawUnsafe<Array<{ convalidated: boolean }>>(
      `SELECT convalidated FROM pg_constraint WHERE conname = 'bir_forms_filed_at_check'`,
    );
    expect(valid).toEqual([{ convalidated: false }]);

    const { firmId, clientId } = await seedClient();
    const ROLLBACK = new Error(
      "rollback: leave the schema exactly as the migration made it",
    );
    const seen: string[] = [];
    /** Run one statement expected to fail, then carry on in the same transaction. */
    const refused = async (
      tx: { $executeRawUnsafe: PrismaClient["$executeRawUnsafe"] },
      sql: string,
      id: string,
    ) => {
      await tx.$executeRawUnsafe("SAVEPOINT s");
      try {
        await tx.$executeRawUnsafe(sql, id);
        seen.push("accepted");
      } catch (err) {
        seen.push(
          /BIR_FORM_SEALED/.test(String(err))
            ? "sealed"
            : /bir_forms_filed_at_check|23514/.test(String(err))
              ? "check"
              : `other: ${String(err).slice(0, 80)}`,
        );
      }
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s");
    };
    await expect(
      writer.$transaction(async (tx) => {
        // Recreate what production may hold: a form filed before "filedAt" existed (filed, NULL)
        // and, for the trigger's second rule, a non-filed row whose filedAt is set (draft, set).
        await tx.$executeRawUnsafe(
          `ALTER TABLE bir_forms DROP CONSTRAINT bir_forms_filed_at_check`,
        );
        const ins = async (status: string, filedAt: string | null) =>
          (
            await tx.$queryRawUnsafe<Array<{ id: string }>>(
              `INSERT INTO bir_forms (id, "firmId", "clientId", form, status, "filedAt", "updatedAt")
               VALUES (gen_random_uuid(), $1::uuid, $2::uuid, '2551Q', $3, $4::timestamp, now()) RETURNING id`,
              firmId,
              clientId,
              status,
              filedAt,
            )
          )[0]!.id;
        const legacyFiled = await ins("filed", null);
        const legacyDraft = await ins("draft", "2026-01-15T00:00:00");
        // The migration's own statement succeeds over them: NOT VALID does not re-check old rows.
        await tx.$executeRawUnsafe(
          `ALTER TABLE bir_forms ADD CONSTRAINT bir_forms_filed_at_check CHECK (("status" = 'filed') = ("filedAt" IS NOT NULL)) NOT VALID`,
        );
        await refused(
          tx,
          `UPDATE bir_forms SET "dataJson" = '{"x":1}'::jsonb WHERE id = $1::uuid`,
          legacyFiled,
        );
        await refused(
          tx,
          `UPDATE bir_forms SET "filedAt" = now() WHERE id = $1::uuid`,
          legacyFiled,
        );
        await refused(
          tx,
          `UPDATE bir_forms SET "filedAt" = NULL WHERE id = $1::uuid`,
          legacyDraft,
        );
        await refused(
          tx,
          `UPDATE bir_forms SET "filedAt" = '2027-01-01T00:00:00' WHERE id = $1::uuid`,
          legacyDraft,
        );
        await refused(
          tx,
          `UPDATE bir_forms SET "dataJson" = '{"x":1}'::jsonb WHERE id = $1::uuid`,
          legacyDraft,
        );
        throw ROLLBACK;
      }),
    ).rejects.toBe(ROLLBACK);

    expect(seen).toEqual([
      "sealed", // (filed, NULL): sealed by the trigger although the CHECK never validated it
      "sealed",
      "sealed", // (draft, set): filedAt → NULL refused by the trigger's second rule, reached on its own
      "sealed", //               filedAt → another value, same rule
      "check", //                any other write is refused by the NOT VALID CHECK, now enforced on updates
    ]);
    // The rollback restored the migration's constraint exactly: still there, still NOT VALID.
    expect(
      await reader.$queryRawUnsafe(
        `SELECT convalidated FROM pg_constraint WHERE conname = 'bir_forms_filed_at_check'`,
      ),
    ).toEqual([{ convalidated: false }]);
  });

  // -------------------------------------------------------------------------
  // T4 — CHECK and UNIQUE coverage, NULLs included, straight INSERTs
  // -------------------------------------------------------------------------

  describe("T4: CHECKs and UNIQUE at the database, NULL coverage", () => {
    let firmId = "";
    let clientId = "";
    beforeEach(async () => {
      ({ firmId, clientId } = await seedClient());
    });

    /** INSERT one row with exactly these values; returns the new id. */
    async function insert(
      status: string | null,
      filedAt: string | null,
      sequence: number | null = 1,
      amendsId: string | null = null,
    ) {
      const rows = await writer.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO bir_forms (id, "firmId", "clientId", form, status, period, "filedAt", "updatedAt", sequence, "amendsId")
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, '2551Q', $3, '2026-Q2', $4::timestamp, now(), $5::int, $6::uuid)
         RETURNING id`,
        firmId,
        clientId,
        status,
        filedAt,
        sequence,
        amendsId,
      );
      return rows[0]!.id;
    }

    it("(draft, NULL) is accepted", async () => {
      const id = await insert("draft", null);
      expect(await reader.birForm.findUnique({ where: { id } })).toMatchObject({
        status: "draft",
        filedAt: null,
      });
    });

    it("(filed, set) is accepted", async () => {
      const id = await insert("filed", "2026-07-20T02:00:00");
      expect((await reader.birForm.findUniqueOrThrow({ where: { id } })).status).toBe(
        "filed",
      );
    });

    it("(filed, NULL) is rejected by bir_forms_filed_at_check", async () => {
      await expect(insert("filed", null)).rejects.toThrow(/bir_forms_filed_at_check/);
    });

    it("(draft, set) is rejected by bir_forms_filed_at_check", async () => {
      await expect(insert("draft", "2026-07-20T02:00:00")).rejects.toThrow(
        /bir_forms_filed_at_check/,
      );
    });

    it("status NULL is rejected by NOT NULL — which is why the CHECK can never evaluate to NULL", async () => {
      // 23502 = not_null_violation (Prisma's raw error carries the code, not the column name).
      await expect(insert(null, null)).rejects.toThrow(/Code: `23502`/);
    });

    it("sequence 0 is rejected by bir_forms_sequence_check; sequence NULL by NOT NULL; sequence 2 accepted", async () => {
      await expect(insert("draft", null, 0)).rejects.toThrow(/bir_forms_sequence_check/);
      await expect(insert("draft", null, null)).rejects.toThrow(/Code: `23502`/); // not_null_violation
      const id = await insert("draft", null, 2);
      expect(await rowJson(id)).toMatchObject({ sequence: 2 });
    });

    it("two rows with the same amendsId are rejected by the unique index; many rows with NULL amendsId are fine", async () => {
      const original = await insert("filed", "2026-07-20T02:00:00");
      await insert("draft", null, 2, original);
      // 23505 = unique_violation on Key ("amendsId"); the index is bir_forms_amendsId_key.
      await expect(insert("draft", null, 2, original)).rejects.toThrow(
        /Code: `23505`[\s\S]*Key \(\\?"amendsId\\?"\)/,
      );
      const idx = await reader.$queryRawUnsafe<Array<{ indexdef: string }>>(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'bir_forms' AND indexname = 'bir_forms_amendsId_key'`,
      );
      expect(idx[0]?.indexdef).toMatch(/^CREATE UNIQUE INDEX .* \("amendsId"\)$/);
      await insert("draft", null, 1, null);
      await insert("draft", null, 1, null);
      const nulls = await reader.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM bir_forms WHERE "amendsId" IS NULL`,
      );
      expect(nulls[0]?.n).toBe(3);
    });

    it("an amendsId that names no form is rejected by the foreign key", async () => {
      await expect(
        insert("draft", null, 2, "00000000-0000-4000-8000-000000000000"),
      ).rejects.toThrow(/bir_forms_amendsId_fkey/);
    });
  });
});

// ---------------------------------------------------------------------------
// Far end (briefing: anything crossing a process boundary): the real service
// writes, a fresh PrismaClient reads back.
// ---------------------------------------------------------------------------

describe("U3 · the service against the real database (far end)", () => {
  truncateBeforeEach();

  let app: INestApplication;
  let svc: BirFormsService;
  let writer: PrismaClient;
  let actor: AuthUser;
  let clientId = "";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    svc = app.get(BirFormsService);
    writer = new PrismaClient();
  });
  afterAll(async () => {
    await writer.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    const firm = await writer.firm.create({ data: { name: `${TAG} firm` } });
    const user = await writer.user.create({
      data: {
        firmId: firm.id,
        userType: "FIRM",
        fullName: `${TAG} accountant`,
        email: `${TAG}@example.com`,
        status: "ACTIVE",
      },
    });
    actor = { id: user.id, firmId: firm.id, userType: "FIRM", email: user.email };
    const client = await writer.client.create({
      data: {
        firmId: firm.id,
        businessName: `${TAG} Trading Co`,
        regName: "HALIMBAWA TRADING CORP",
        tin: "000111222",
        branch: "00000",
        rdo: "000",
        address: "1 Halimbawa St",
        city: "Lungsod ng Halimbawa",
        zip: "0000",
        taxType: "PERCENTAGE",
      },
    });
    clientId = client.id;
  });

  async function rowOf(reader: PrismaClient, id: string): Promise<unknown> {
    const r = await reader.$queryRawUnsafe<Array<{ r: unknown }>>(
      `SELECT to_jsonb(b) AS r FROM bir_forms b WHERE b.id = $1::uuid`,
      id,
    );
    return r[0]?.r ?? null;
  }

  it("filing through the service writes filedAt and the snapshot together; a fresh client reads the R3 keys back", async () => {
    const created = await svc.create(actor, {
      clientId,
      form: "2551Q",
      period: "2026-Q2",
      data: { rows: [] },
    });
    await svc.update(actor, created.id, { status: "filed" });
    const reader = new PrismaClient();
    try {
      const back = await reader.birForm.findUniqueOrThrow({ where: { id: created.id } });
      expect(back.status).toBe("filed");
      expect(back.filedAt).not.toBeNull();
      const snap = back.filedSnapshotJson as Record<string, unknown>;
      expect(snap).toMatchObject({
        businessName: `${TAG} Trading Co`,
        tin: "000111222",
        branch: "00000",
        address: "1 Halimbawa St",
        city: "Lungsod ng Halimbawa",
        zip: "0000",
        rdo: "000",
        regName: "HALIMBAWA TRADING CORP",
        kind: "non-individual",
        clientId,
      });
      expect(snap.takenAt).toBe(back.filedAt?.toISOString());
      // …and the client may change afterwards: the filed form's copy does not.
      await writer.client.update({
        where: { id: clientId },
        data: { tin: "000333444", businessName: "Renamed Co" },
      });
      const again = await reader.birForm.findUniqueOrThrow({ where: { id: created.id } });
      expect(again.filedSnapshotJson).toEqual(back.filedSnapshotJson);
    } finally {
      await reader.$disconnect();
    }
  });

  it("a PATCH of a filed form through the service is 409 and the row is unchanged", async () => {
    const created = await svc.create(actor, {
      clientId,
      form: "2551Q",
      period: "2026-Q2",
      data: { rows: [] },
    });
    await svc.update(actor, created.id, { status: "filed" });
    const reader = new PrismaClient();
    try {
      const before = await rowOf(reader, created.id);
      await expect(
        svc.update(actor, created.id, { status: "draft" }),
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        svc.update(actor, created.id, { data: { rows: [{ taxable: "1" }] } }),
      ).rejects.toMatchObject({ status: 409 });
      expect(await rowOf(reader, created.id)).toEqual(before);
    } finally {
      await reader.$disconnect();
    }
  });

  it("amend through the service: the draft persists (sequence 2, amendsId, data verbatim with unknown keys); the original row is byte-for-byte unchanged", async () => {
    const data = {
      rows: [{ atc: "PT010", taxable: "100000", rate: "3" }],
      payeeZip: "0000",
      signatoryName: "S",
    };
    const created = await svc.create(actor, {
      clientId,
      form: "2551Q",
      period: "2026-Q2",
      data,
    });
    await svc.update(actor, created.id, { status: "filed" });
    const reader = new PrismaClient();
    try {
      const before = await rowOf(reader, created.id);
      const res = await svc.amend(actor, created.id);
      expect(res).toEqual({
        id: expect.any(String),
        status: "draft",
        sequence: 2,
        amendsId: created.id,
      });
      const draft = await reader.birForm.findUniqueOrThrow({ where: { id: res.id } });
      expect(draft).toMatchObject({
        status: "draft",
        sequence: 2,
        amendsId: created.id,
        clientId,
        form: "2551Q",
        period: "2026-Q2",
        filedAt: null,
        filedSnapshotJson: null,
      });
      expect(draft.dataJson).toEqual(data);
      expect(await rowOf(reader, created.id)).toEqual(before);
      // The amendment keeps the period of the return it amends.
      await expect(
        svc.update(actor, res.id, { period: "2026-Q3" }),
      ).rejects.toMatchObject({ status: 400 });
      expect(
        (await reader.birForm.findUniqueOrThrow({ where: { id: res.id } })).period,
      ).toBe("2026-Q2");
      const audit = await reader.auditLog.findFirst({
        where: { action: "bir-form.amended", entityId: res.id },
      });
      expect(audit?.metadata).toEqual({ amendsId: created.id, sequence: 2 });
      // A second amendment of the same original is refused; the amendment itself is amended once filed.
      await expect(svc.amend(actor, created.id)).rejects.toMatchObject({ status: 409 });
      await svc.update(actor, res.id, { status: "filed" });
      const third = await svc.amend(actor, res.id);
      expect(third).toMatchObject({ sequence: 3, amendsId: res.id });
    } finally {
      await reader.$disconnect();
    }
  });

  it("amend of a filed 2307 is 400 and creates nothing", async () => {
    const created = await svc.create(actor, {
      clientId,
      form: "2307",
      period: "2026-Q2",
      data: {},
    });
    await svc.update(actor, created.id, { status: "filed" });
    await expect(svc.amend(actor, created.id)).rejects.toMatchObject({ status: 400 });
    const reader = new PrismaClient();
    try {
      expect(await reader.birForm.count({ where: { amendsId: created.id } })).toBe(0);
    } finally {
      await reader.$disconnect();
    }
  });
});
