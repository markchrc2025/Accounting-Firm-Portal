/**
 * track-a-confirmation.db-spec.ts — U18, over HTTP against the real Nest app and the
 * local PostgreSQL: marking a return filed needs the BIR's confirmation e-mail (or a
 * Super Admin's override), the PDF is checked, kept and shown, and the seal on a filed
 * return still holds while a confirmation is written beside it. Every TIN, name and
 * address is invented; the fixture PDFs are built in the test with pdf-lib.
 *
 *   T1  the check endpoint: no side effects, every check named
 *   T2  Mark as filed: the contract, the filed date, the kept PDF, the refusals
 *   T3  attach to a return already filed: once, replace, the old row kept
 *   T4  the override: Super Admin only, a reason, "filed without BIR confirmation"
 *   T5  download, audit events, duplicates across returns, amendments
 *   T6  the seal: a confirmation can be written beside a filed return, the return cannot
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { confirmationPdf, VERIFIED } from "../helpers/confirmation-pdf";
import { FakeStorage } from "../helpers/file-return";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"] });

const TAG = `track-a-confirmation-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";

// --- the sentences a person reads (word for word) -----------------------------------
const NEEDS_CONFIRMATION =
  "Marking this return as filed needs the BIR confirmation email. Upload it with Mark as filed.";
const NO_FILE = 'Attach the BIR confirmation as a PDF in the multipart field "file".';
const NOT_BIR = "This is not a BIR eBIRForms confirmation email.";
const ALREADY_FILED =
  "This return is already filed. To add the BIR confirmation to it, use Attach confirmation.";
const NOT_FILED_YET = "This return is not filed yet. Mark it as filed with the BIR confirmation.";
const HAS_ONE = "This return already has a BIR confirmation. Only a Super Admin can replace it.";
const REPLACE_SA = "Only a Super Admin can replace the BIR confirmation.";
const OVERRIDE_SA = "Only a Super Admin can file a return without the BIR confirmation.";
const SHORT_REASON = "Give the reason in at least 10 characters.";
const NO_FILE_KEPT = "This return has no BIR confirmation file.";
const NONE_FOR = (form: string) =>
  `The BIR sends no confirmation email for the ${form}, so there is nothing to upload.`;

describe("U18 · BIR filing confirmation (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  const storage = new FakeStorage();
  let firmId = "";
  let saToken = "";
  let managerToken = "";
  let outsiderToken = "";
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const auth = (r: request.Test, t = saToken) => r.set("Authorization", `Bearer ${t}`);

  async function client(
    key: string,
    tin: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const c = await db.client.create({
      data: {
        firmId,
        businessName: `${TAG} ${key} TRADING CORP`,
        regName: `${TAG} ${key} TRADING CORP`,
        kind: "non-individual",
        tin,
        branch: "00000",
        rdo: "038",
        address: "1 Invented St",
        city: "Lungsod ng Halimbawa",
        zip: "0000",
        taxType: "VAT",
        ...extra,
      },
    });
    ids[key] = c.id;
    return c.id;
  }

  async function draft(key: string, form: string, period: string) {
    const res = await auth(http().post(`${API}/bir-forms`)).send({
      clientId: ids[key],
      form,
      period,
      data: {},
    });
    expect([key, form, period, res.status]).toEqual([key, form, period, 201]);
    return res.body as { id: string };
  }

  const upload = (path: string, bytes: Buffer, token = saToken, fields: Record<string, string> = {}) => {
    let r = auth(http().post(`${API}${path}`), token);
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return r.attach("file", bytes, { filename: "confirmation.pdf", contentType: "application/pdf" });
  };
  const check = (id: string, bytes: Buffer, token = saToken) =>
    upload(`/bir-forms/${id}/confirmation/check`, bytes, token);
  const markFiled = (id: string, bytes: Buffer, token = saToken) =>
    upload(`/bir-forms/${id}/mark-filed`, bytes, token);
  const attach = (id: string, bytes: Buffer, token = saToken, fields: Record<string, string> = {}) =>
    upload(`/bir-forms/${id}/confirmation`, bytes, token, fields);

  const rowsFor = (birFormId: string) =>
    db.birFormConfirmation.findMany({ where: { birFormId }, orderBy: { uploadedAt: "asc" } });

  /** A filed return the way every return filed before U18 looks: no confirmation. */
  async function filedBefore(key: string, form: string, period: string) {
    const f = await db.birForm.create({
      data: {
        firmId,
        clientId: ids[key]!,
        form,
        period,
        status: "filed",
        filedAt: new Date("2026-04-20T02:00:00.000Z"),
        filedSnapshotJson: { snapshotVersion: 1, businessName: `${TAG} ${key} TRADING CORP` },
      },
    });
    return f.id;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get(PrismaService);
    const tokens = app.get(TokenService);
    firmId = (await db.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } })).id;
    const role = async (name: string) =>
      (await db.role.findUniqueOrThrow({ where: { name_scope: { name, scope: "FIRM" } } })).id;
    const mk = async (label: string, roleName: string, assign: string[] = []) => {
      const u = await db.user.create({
        data: {
          firmId,
          userType: "FIRM",
          fullName: `${TAG} ${label}`,
          email: `${TAG}-${label}@example.com`,
          status: "ACTIVE",
          firmProfile: {
            create: {
              title: "Test",
              ...(assign.length
                ? { clientAssignments: { create: assign.map((clientId) => ({ clientId })) } }
                : {}),
            },
          },
          userRoles: { create: { roleId: await role(roleName) } },
        },
      });
      return tokens.signAccess({ id: u.id, firmId, userType: "FIRM", email: u.email });
    };
    saToken = await mk("sa", "Super Admin");
    await client("CAL", "111222333"); // calendar year
    await client("FIS", "444555666", { fiscalYearStart: new Date("2025-07-01T00:00:00.000Z") }); // year ends in June
    await client("OTHER", "777888999");
    await client("BRANCH", "111222333", { branch: "00012", hasBranches: true });
    managerToken = await mk("manager", "Manager", [ids.CAL!, ids.FIS!]);
    outsiderToken = await mk("outsider", "Manager", [ids.OTHER!]);
  });
  afterAll(async () => {
    await app.close();
  });
  // The database is truncated once for this file, so each test starts from no
  // confirmations (the same invented e-mail is offered in many tests).
  beforeEach(async () => {
    storage.objects.clear();
    await db.birFormConfirmation.deleteMany({});
  });

  // ======================================================================================
  describe("T1 · the check endpoint has no side effects", () => {
    it("answers every check with its status and words, and changes nothing", async () => {
      const f = await draft("CAL", "2550Q", "2026-Q1");
      const before = {
        objects: storage.objects.size,
        rows: await db.birFormConfirmation.count(),
        form: await db.birForm.findUniqueOrThrow({ where: { id: f.id } }),
      };
      const res = await check(f.id, await confirmationPdf({}));
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.checks.map((c: { n: number; id: string }) => [c.n, c.id])).toEqual([
        [1, "bir-email"],
        [2, "file-name"],
        [3, "taxpayer"],
        [4, "form"],
        [5, "period"],
        [6, "received"],
        [7, "duplicate"],
        [8, "timing"],
        [9, "upload"],
      ]);
      expect(res.body.filedOn).toBe("2026-04-25");
      expect(res.body.parsed).toMatchObject({
        birFileName: "111222333000-2550Qv2024-122026Q1.xml",
        form: "2550Q",
        taxYear: 2026,
        quarter: 1,
      });
      expect(JSON.stringify(res.body)).not.toContain("owner@example.test");
      expect(storage.objects.size).toBe(before.objects);
      expect(await db.birFormConfirmation.count()).toBe(before.rows);
      const after = await db.birForm.findUniqueOrThrow({ where: { id: f.id } });
      expect(after.status).toBe("draft");
      expect(after.updatedAt.toISOString()).toBe(before.form.updatedAt.toISOString());
    });

    it("reports a wrong confirmation with the check that failed, still 200", async () => {
      const f = await draft("CAL", "2550Q", "2026-Q3");
      const res = await check(f.id, await confirmationPdf({}));
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.errors).toEqual(["The confirmation is for 2026 Q1, this return is 2026 Q3."]);
      expect(res.body.checks.find((c: { id: string }) => c.id === "period")).toMatchObject({
        status: "error",
        message: "The confirmation is for 2026 Q1, this return is 2026 Q3.",
      });
    });

    it("needs the file, is for the firm's own returns, and respects the client assignment", async () => {
      const f = await draft("CAL", "2550Q", "2026-Q1");
      const bytes = await confirmationPdf({});
      expect((await auth(http().post(`${API}/bir-forms/${f.id}/confirmation/check`))).status).toBe(400);
      expect((await check(randomUUID(), bytes)).status).toBe(404);
      expect((await check(f.id, bytes, outsiderToken)).status).toBe(403);
      expect((await check(f.id, bytes, managerToken)).status).toBe(200);
    });

    it("an upload over 5 MB, one that is not a PDF, and one that is a picture are answered in words, 200", async () => {
      const f = await draft("CAL", "2550Q", "2026-Q1");
      const big = await check(f.id, await confirmationPdf({ padToBytes: 5 * 1024 * 1024 + 1 }));
      expect([big.status, big.body.ok, big.body.errors]).toEqual([200, false, ["The PDF is larger than 5 MB."]]);
      const text = await check(f.id, Buffer.from("this is not a pdf"));
      expect(text.body.errors).toEqual(["The file is not a PDF."]);
      const picture = await check(f.id, await confirmationPdf({ pictureOnly: true }));
      expect(picture.body.errors).toEqual([
        "This PDF is a picture. Print the email to PDF from Gmail instead of scanning it.",
      ]);
      // every other check is "skipped", not failed
      expect(picture.body.checks.filter((c: { status: string }) => c.status === "skipped")).toHaveLength(8);
    });

    it("a 1601C, a 2307 and a 2316 have no confirmation to check", async () => {
      for (const [form, period] of [
        ["1601C", "2026-07"],
        ["2307", "2026-Q1"],
        ["2316", "2026"],
      ] as const) {
        const f = await draft("CAL", form, period);
        const res = await check(f.id, await confirmationPdf({}));
        expect([form, res.status, res.body.message]).toEqual([form, 400, NONE_FOR(form)]);
      }
    });
  });

  // ======================================================================================
  describe("T2 · Mark as filed takes the confirmation", () => {
    it("refuses PATCH status filed for the nine returns, and still files a 1601C as before", async () => {
      for (const [form, period] of [
        ["2550Q", "2026-Q1"],
        ["2551Q", "2026-Q1"],
        ["1701Q", "2026-Q1"],
        ["1701A", "2025"],
        ["1701", "2025"],
        ["1702Q", "2026-Q1"],
        ["1702RT", "2025"],
        ["0619E", "2026-07"],
        ["1601EQ", "2026-Q3"],
      ] as const) {
        const f = await draft("CAL", form, period);
        const res = await auth(http().patch(`${API}/bir-forms/${f.id}`)).send({ status: "filed" });
        expect([form, res.status, res.body.message]).toEqual([form, 409, NEEDS_CONFIRMATION]);
        expect((await db.birForm.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("draft");
      }
      const c = await draft("CAL", "1601C", "2026-07");
      const filed = await auth(http().patch(`${API}/bir-forms/${c.id}`)).send({ status: "filed" });
      expect(filed.status).toBe(200);
      expect(filed.body.status).toBe("filed");
      expect(filed.body.confirmation).toBeNull();
      // a draft can still be edited through PATCH
      const d = await draft("CAL", "2550Q", "2026-Q2");
      expect((await auth(http().patch(`${API}/bir-forms/${d.id}`)).send({ data: { a: "1" } })).status).toBe(200);
    });

    it("files the return on the date the BIR received it, keeps the PDF, and shows it", async () => {
      const f = await draft("CAL", "2550Q", "2026-Q1");
      const bytes = await confirmationPdf({});
      const res = await markFiled(f.id, bytes);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: f.id,
        status: "filed",
        filedAt: "2026-04-25T03:40:00.000Z",
        confirmation: {
          kind: "bir_email",
          birFileName: "111222333000-2550Qv2024-122026Q1.xml",
          receivedAt: "2026-04-25T03:40:00.000Z",
          filedOn: "2026-04-25",
          hasFile: true,
          filedWithoutConfirmation: false,
          overrideReason: null,
          warnings: [],
        },
        confirmationRequired: true,
      });
      expect(res.body.filedSnapshot).toMatchObject({ businessName: `${TAG} CAL TRADING CORP` });
      const [row] = await rowsFor(f.id);
      expect(row).toMatchObject({
        kind: "bir_email",
        firmId,
        birFormId: f.id,
        birFileName: "111222333000-2550Qv2024-122026Q1.xml",
        tinWithBranch: "111222333-00000",
        formCode: "2550Q",
        taxYear: 2026,
        quarter: 1,
        fyEndMonth: 12,
        supersededAt: null,
        overrideReason: null,
      });
      expect(row!.receivedAt!.toISOString()).toBe("2026-04-25T03:40:00.000Z");
      expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(Buffer.from(storage.objects.get(row!.storageKey!)!.body).equals(bytes)).toBe(true);
      expect(storage.objects.get(row!.storageKey!)!.contentType).toBe("application/pdf");
      // no recipient name or address is stored beside the PDF
      expect(JSON.stringify(row)).not.toContain("owner@example.test");
      expect(JSON.stringify(row)).not.toContain("Invented Recipient");
      // the detail endpoint shows it too
      const one = await auth(http().get(`${API}/bir-forms/${f.id}`));
      expect(one.body.confirmation).toMatchObject({ kind: "bir_email", hasFile: true });
    });

    it("files the 0619E, the 1601EQ and the 1701Q on their verified file names", async () => {
      const cases: Array<[string, string, keyof typeof VERIFIED, string, string, string]> = [
        ["0619E", "2026-07", "0619E", "10 August 2026", "12:05 AM", "2026-08-09T16:05:00.000Z"],
        ["1601EQ", "2026-Q3", "1601EQ", "2 November 2026", "12:05 PM", "2026-11-02T04:05:00.000Z"],
        ["1701Q", "2025-Q3", "1701Q", "14 November 2025", "02:44 PM", "2025-11-14T06:44:00.000Z"],
      ];
      for (const [form, period, shape, date, time, at] of cases) {
        const f = await draft("CAL", form, period);
        const res = await markFiled(f.id, await confirmationPdf({ fileName: VERIFIED[shape], date, time }));
        expect([form, res.status, res.body.message]).toEqual([form, 200, undefined]);
        expect(res.body.filedAt).toBe(at);
      }
    });

    it("a fiscal-year client: the 2550Q's year-end month must be the client's", async () => {
      const f = await draft("FIS", "2550Q", "2026-Q1");
      const wrong = await markFiled(f.id, await confirmationPdf({ fileName: "444555666000-2550Qv2024-122026Q1.xml" }));
      expect(wrong.status).toBe(409);
      expect(wrong.body.message).toBe(
        "The confirmation is for a fiscal year ending in December, this client's fiscal year ends in June.",
      );
      const right = await markFiled(f.id, await confirmationPdf({ fileName: "444555666000-2550Qv2024-062026Q1.xml" }));
      expect(right.status).toBe(200);
      expect((await rowsFor(f.id))[0]!.fyEndMonth).toBe(6);
    });

    it("a wrong confirmation is refused: 409, the first error in the message, every check in the body, nothing written", async () => {
      const f = await draft("CAL", "2550Q", "2026-Q1");
      const objects = storage.objects.size;
      const res = await markFiled(f.id, await confirmationPdf({ fileName: "999888777000-2550Qv2024-122026Q1.xml" }));
      expect(res.status).toBe(409);
      expect(res.body.message).toBe("The confirmation is for TIN 999-888-777-000, not this client.");
      expect(res.body.ok).toBe(false);
      expect(res.body.checks).toHaveLength(9);
      expect((await db.birForm.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("draft");
      expect(await rowsFor(f.id)).toHaveLength(0);
      expect(storage.objects.size).toBe(objects);
      const notBir = await markFiled(f.id, await confirmationPdf({ sender: "x@example.test" }));
      expect([notBir.status, notBir.body.message]).toEqual([409, NOT_BIR]);
    });

    it("needs a file or an override, and a return not already filed", async () => {
      const f = await draft("CAL", "2550Q", "2026-Q1");
      const none = await auth(http().post(`${API}/bir-forms/${f.id}/mark-filed`));
      expect([none.status, none.body.message]).toEqual([400, NO_FILE]);
      const c = await draft("CAL", "1601C", "2026-08");
      const res = await markFiled(c.id, await confirmationPdf({}));
      expect([res.status, res.body.message]).toEqual([400, NONE_FOR("1601C")]);
      await markFiled(f.id, await confirmationPdf({}));
      const again = await markFiled(f.id, await confirmationPdf({ time: "11:41 AM" }));
      expect([again.status, again.body.message]).toEqual([409, ALREADY_FILED]);
    });

    it("the six-ATC refusal of a 1601-EQ still stands before the confirmation is read", async () => {
      const f = await draft("CAL", "1601EQ", "2026-Q2");
      const rows = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ atc: `WI0${n}0`, base: "100.00", rate: "1", withheld: "1.00" }));
      await auth(http().patch(`${API}/bir-forms/${f.id}`)).send({ data: { rows } });
      const res = await markFiled(
        f.id,
        await confirmationPdf({ fileName: "11122233300000-1601EQ-2026Q2.xml", date: "20 July 2026", time: "10:00 AM" }),
      );
      expect([res.status, res.body.message]).toEqual([409, "7 ATCs; the form has six rows."]);
    });
  });

  // ======================================================================================
  describe("T3 · attach to a return already filed", () => {
    it("checks, keeps and shows the PDF without touching the filing, once", async () => {
      const id = await filedBefore("CAL", "2550Q", "2026-Q1");
      const before = await db.birForm.findUniqueOrThrow({ where: { id } });
      const bytes = await confirmationPdf({});
      const res = await attach(id, bytes);
      expect(res.status).toBe(200);
      expect(res.body.confirmation).toMatchObject({ kind: "bir_email", hasFile: true, filedWithoutConfirmation: false });
      const after = await db.birForm.findUniqueOrThrow({ where: { id } });
      expect(after.filedAt!.toISOString()).toBe(before.filedAt!.toISOString()); // not the BIR date
      expect(JSON.stringify(after.filedSnapshotJson)).toBe(JSON.stringify(before.filedSnapshotJson));
      expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
      expect(res.body.filedAt).toBe("2026-04-20T02:00:00.000Z");
      // a second attach is refused; replacing needs a Super Admin
      const twice = await attach(id, await confirmationPdf({ time: "11:41 AM" }), managerToken);
      expect([twice.status, twice.body.message]).toEqual([409, HAS_ONE]);
      const replace = await attach(id, await confirmationPdf({ time: "11:41 AM" }), managerToken, { replace: "true" });
      expect([replace.status, replace.body.message]).toEqual([403, REPLACE_SA]);
      expect(await rowsFor(id)).toHaveLength(1);
    });

    it("a Super Admin replaces it: the old row is kept, marked superseded, and never deleted", async () => {
      const id = await filedBefore("CAL", "2550Q", "2026-Q1");
      await attach(id, await confirmationPdf({}));
      const old = (await rowsFor(id))[0]!;
      const res = await attach(id, await confirmationPdf({ time: "11:45 AM" }), saToken, { replace: "true" });
      expect(res.status).toBe(200);
      const rows = await rowsFor(id);
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === old.id)!.supersededAt).not.toBeNull();
      const active = rows.filter((r) => r.supersededAt === null);
      expect(active).toHaveLength(1);
      expect(active[0]!.receivedAt!.toISOString()).toBe("2026-04-25T03:45:00.000Z");
      expect(res.body.confirmation.receivedAt).toBe("2026-04-25T03:45:00.000Z");
      // the first PDF is still in storage
      expect(storage.objects.has(old.storageKey!)).toBe(true);
    });

    it("a draft is not filed yet; a wrong confirmation is refused like Mark as filed", async () => {
      const d = await draft("CAL", "2550Q", "2026-Q1");
      const res = await attach(d.id, await confirmationPdf({}));
      expect([res.status, res.body.message]).toEqual([409, NOT_FILED_YET]);
      const id = await filedBefore("CAL", "2551Q", "2026-Q2");
      const wrong = await attach(id, await confirmationPdf({}));
      expect(wrong.status).toBe(409);
      expect(wrong.body.message).toBe("The confirmation is for form 2550Q, not 2551Q.");
      expect(await rowsFor(id)).toHaveLength(0);
    });
  });

  // ======================================================================================
  describe("T4 · the override", () => {
    it("is for a Super Admin only, with a reason of at least 10 characters", async () => {
      const f = await draft("CAL", "1701Q", "2026-Q1");
      const reason = "The BIR email was lost; filed on the portal screenshot.";
      const asManager = await auth(http().post(`${API}/bir-forms/${f.id}/mark-filed`), managerToken).field("overrideReason", reason);
      expect([asManager.status, asManager.body.message]).toEqual([403, OVERRIDE_SA]);
      const short = await auth(http().post(`${API}/bir-forms/${f.id}/mark-filed`)).field("overrideReason", "too short");
      expect([short.status, short.body.message]).toEqual([400, SHORT_REASON]);
      expect(await rowsFor(f.id)).toHaveLength(0);
      expect((await db.birForm.findUniqueOrThrow({ where: { id: f.id } })).status).toBe("draft");

      const ok = await auth(http().post(`${API}/bir-forms/${f.id}/mark-filed`)).field("overrideReason", reason);
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe("filed");
      expect(ok.body.confirmation).toMatchObject({
        kind: "override",
        overrideReason: reason,
        hasFile: false,
        filedWithoutConfirmation: true,
        birFileName: null,
        receivedAt: null,
      });
      const [row] = await rowsFor(f.id);
      expect(row).toMatchObject({ kind: "override", overrideReason: reason, storageKey: null, sha256: null });
      expect(row!.uploadedByUserId).toEqual(expect.any(String));
      expect(ok.body.filedAt).toEqual(expect.any(String)); // the moment it was marked: the BIR date is unknown
    });

    it("an override can be attached to a return already filed, and replaced by the real e-mail", async () => {
      const id = await filedBefore("CAL", "2550Q", "2026-Q1");
      const reason = "No email was ever received; BIR confirmed by phone.";
      const res = await auth(http().post(`${API}/bir-forms/${id}/confirmation`)).field("overrideReason", reason);
      expect(res.status).toBe(200);
      expect(res.body.confirmation).toMatchObject({ kind: "override", filedWithoutConfirmation: true });
      const replaced = await attach(id, await confirmationPdf({}), saToken, { replace: "true" });
      expect(replaced.status).toBe(200);
      expect(replaced.body.confirmation).toMatchObject({ kind: "bir_email", filedWithoutConfirmation: false });
      expect(await rowsFor(id)).toHaveLength(2);
    });
  });

  // ======================================================================================
  describe("T5 · download, audit, duplicates, amendments", () => {
    it("serves the kept PDF through a signed link, under a name of its own", async () => {
      const f = await draft("CAL", "2550Q", "2026-Q1");
      await markFiled(f.id, await confirmationPdf({}));
      const res = await auth(http().get(`${API}/bir-forms/${f.id}/confirmation/url`));
      expect(res.status).toBe(200);
      const [row] = await rowsFor(f.id);
      expect(res.body.url).toContain(row!.storageKey!);
      expect(res.body.url).toContain(encodeURIComponent("111222333000-2550Qv2024-122026Q1-BIR-confirmation.pdf"));
      expect((await auth(http().get(`${API}/bir-forms/${f.id}/confirmation/url`), outsiderToken)).status).toBe(403);
      const none = await draft("CAL", "2550Q", "2026-Q2");
      const nope = await auth(http().get(`${API}/bir-forms/${none.id}/confirmation/url`));
      expect([nope.status, nope.body.message]).toEqual([404, NO_FILE_KEPT]);
    });

    it("writes an audit event for the upload, the attach, the replace and the override, without the e-mail's text", async () => {
      const a = await draft("CAL", "2550Q", "2026-Q1");
      await markFiled(a.id, await confirmationPdf({}));
      const b = await filedBefore("CAL", "2551Q", "2026-Q1");
      await attach(b, await confirmationPdf({ fileName: "1112223330002551Qv2018122026Q1.xml" }));
      await attach(b, await confirmationPdf({ fileName: "1112223330002551Qv2018122026Q1.xml", time: "11:50 AM" }), saToken, { replace: "true" });
      const c = await draft("CAL", "1701Q", "2026-Q2");
      await auth(http().post(`${API}/bir-forms/${c.id}/mark-filed`)).field("overrideReason", "Lost the email; checked on eBIRForms.");
      const rows = await db.auditLog.findMany({
        where: { action: { startsWith: "bir-form." }, entityId: { in: [a.id, b, c.id] } },
      });
      const actions = rows.map((r) => `${r.action}`).sort();
      expect(actions).toEqual(
        expect.arrayContaining([
          "bir-form.mark-filed",
          "bir-form.confirmation.attach",
          "bir-form.confirmation.replace",
          "bir-form.confirmation.override",
        ]),
      );
      expect(JSON.stringify(rows)).not.toContain("owner@example.test");
      expect(JSON.stringify(rows)).not.toContain("Invented Recipient");
    });

    it("the same confirmation cannot be attached to a second return: same file and time, or the same bytes", async () => {
      const first = await draft("CAL", "2550Q", "2026-Q1");
      const bytes = await confirmationPdf({});
      expect((await markFiled(first.id, bytes)).status).toBe(200);
      // the same e-mail offered to another client's return of the same form and period
      const other = await draft("OTHER", "2550Q", "2026-Q1");
      const res = await markFiled(other.id, bytes);
      expect(res.status).toBe(409);
      const dup = res.body.checks.find((c: { id: string }) => c.id === "duplicate");
      expect(dup).toMatchObject({
        status: "error",
        message: `This confirmation is already attached to 2550Q, ${TAG} CAL TRADING CORP, 2026-Q1.`,
      });
      // the same file name and time, different bytes (a re-print): still the same confirmation
      const reprint = await confirmationPdf({ sentOn: "Sat, 25 Apr 2026, 11:59 am" });
      expect(reprint.equals(bytes)).toBe(false);
      const second = await markFiled(other.id, reprint);
      expect(second.body.checks.find((c: { id: string }) => c.id === "duplicate").status).toBe("error");
      expect(await rowsFor(other.id)).toHaveLength(0);
    });

    it("the same bytes under another return are caught (and a TIN that is not that client's is named)", async () => {
      const a = await draft("CAL", "0619E", "2026-07");
      const bytes = await confirmationPdf({ fileName: VERIFIED["0619E"], date: "10 August 2026", time: "10:00 AM" });
      expect((await markFiled(a.id, bytes)).status).toBe(200);
      const b = await draft("OTHER", "0619E", "2026-07");
      const res = await check(b.id, bytes);
      const checks = res.body.checks as Array<{ id: string; status: string; message: string }>;
      expect(checks.find((c) => c.id === "duplicate")!.status).toBe("error");
      expect(checks.find((c) => c.id === "taxpayer")!.status).toBe("error"); // and the TIN is not OTHER's
    });

    it("an amendment is marked filed with its own confirmation; the original keeps its own", async () => {
      const f = await draft("CAL", "2550Q", "2026-Q1");
      await markFiled(f.id, await confirmationPdf({}));
      const amend = await auth(http().post(`${API}/bir-forms/${f.id}/amend`));
      expect(amend.status).toBe(201);
      const res = await markFiled(
        amend.body.id,
        await confirmationPdf({ fileName: "111222333000-2550Qv2024-122026Q1V1.xml", date: "2 May 2026", time: "09:00 AM" }),
      );
      expect(res.status).toBe(200);
      expect(res.body.confirmation.birFileName).toBe("111222333000-2550Qv2024-122026Q1V1.xml");
      expect(await rowsFor(f.id)).toHaveLength(1);
      expect(await rowsFor(amend.body.id)).toHaveLength(1);
    });

    it("keeps the late warning with the confirmation and lets the filing through", async () => {
      const f = await draft("CAL", "2550Q", "2026-Q1");
      const res = await markFiled(f.id, await confirmationPdf({ date: "30 April 2026", time: "10:00 AM" }));
      expect(res.status).toBe(200);
      expect(res.body.confirmation.warnings).toEqual([
        "The BIR received this return on 30 April 2026, 3 days after the due date of 27 April 2026.",
      ]);
    });
  });

  // ======================================================================================
  describe("T6 · the seal still holds", () => {
    it("a confirmation is written beside a filed return while a direct update of the return is refused", async () => {
      const id = await filedBefore("CAL", "2550Q", "2026-Q1");
      expect((await attach(id, await confirmationPdf({}))).status).toBe(200);
      await expect(
        db.$executeRawUnsafe(`UPDATE "bir_forms" SET "period" = '2026-Q4' WHERE "id" = $1::uuid`, id),
      ).rejects.toThrow(/BIR_FORM_SEALED/);
      await expect(db.birForm.update({ where: { id }, data: { dataJson: { a: 1 } } })).rejects.toThrow(/BIR_FORM_SEALED/);
      await expect(db.birForm.delete({ where: { id } })).rejects.toThrow(/BIR_FORM_SEALED/);
      expect((await db.birForm.findUniqueOrThrow({ where: { id } })).period).toBe("2026-Q1");
    });

    it("at most one active confirmation per return, and one confirmation per file name and time or per set of bytes, at the database", async () => {
      const id = await filedBefore("CAL", "2550Q", "2026-Q1");
      await attach(id, await confirmationPdf({}));
      const [row] = await rowsFor(id);
      const clone = (over: Record<string, unknown>) =>
        db.birFormConfirmation.create({
          data: {
            firmId,
            birFormId: id,
            kind: "bir_email",
            storageKey: "k",
            originalFilename: "x.pdf",
            sha256: randomUUID().replace(/-/g, "").padEnd(64, "0"),
            birFileName: "other.xml",
            tinWithBranch: "111222333-00000",
            formCode: "2550Q",
            taxYear: 2026,
            quarter: 1,
            fyEndMonth: 12,
            receivedAt: new Date("2026-05-01T00:00:00.000Z"),
            uploadedByUserId: row!.uploadedByUserId,
            warnings: [],
            ...over,
          },
        });
      await expect(clone({})).rejects.toThrow(/Unique constraint|duplicate key/i); // a second ACTIVE one
      const f2 = await filedBefore("CAL", "2550Q", "2026-Q2");
      await expect(clone({ birFormId: f2, sha256: row!.sha256 })).rejects.toThrow(/Unique constraint|duplicate key/i); // same bytes
      await expect(
        clone({ birFormId: f2, birFileName: row!.birFileName, receivedAt: row!.receivedAt }),
      ).rejects.toThrow(/Unique constraint|duplicate key/i); // same file name and time
      await expect(clone({ birFormId: f2 })).resolves.toBeDefined(); // a different one is fine
    });
  });
});
