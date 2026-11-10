/**
 * track-a-live-preview.db-spec.ts — U23 (D64): the Preview PDF of what the editor holds
 * NOW, unsaved: POST /bir-forms/:id/preview with { data }. Over HTTP against the real Nest
 * app and the local PostgreSQL, with an in-memory object store. Every firm, client, TIN and
 * figure is invented.
 *
 * T1  For every form with a Preview: unsaved data changes the PDF and nothing is saved,
 *     stored or audited; the same data prints the same as the saved Preview.
 * T2  The refusals: from unsaved data (409 with refusals[]), the contact number beside
 *     them, a body PATCH would refuse (400), a filed return that ignores the body, a form
 *     with no Preview, another firm's return (404), no permission (403).
 * T3  The limit: 40 a minute per user, then 429.
 * T4  How long each form takes to render (median of 3), printed for Track B.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { FakeStorage } from "../helpers/file-return";
import { PREVIEW_FIXTURES, type PreviewFixture } from "../helpers/preview-fixtures";
import { BIR_PDF, loadMap, readPdfText } from "./helpers/pdf-text";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { previewLimiter } from "../../src/bir-forms/preview-limit";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin", "Manager"] });

const TAG = `track-a-live-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const PREVIEW_FILED = "This return is filed. Use Download clear copy.";
const TOO_MANY = "Too many previews; wait a moment.";
const CONTACT =
  "Add the client's contact number before this return leaves the Portal. eBIRForms will not submit a return without one.";
const FOOTER = /^Preview printed /;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;

function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

describe("U23 · the Preview PDF from unsaved edits (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  const storage = new FakeStorage();
  let firmId = "";
  let token = "";
  let otherFirmToken = "";
  let managerToken = "";
  const clients = { ind: "", corp: "", corpNoPhone: "" };

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test, t = token) => r.set("Authorization", `Bearer ${t}`);

  async function newClient(kind: "ind" | "corp", phone: string | null, tin: string) {
    return (
      await db.client.create({
        data: {
          firmId,
          ...(kind === "ind"
            ? {
                kind: "individual",
                lastName: "HALIMBAWA",
                firstName: "JUANA",
                middleName: "SUBOK",
                businessName: `${TAG} Halimbawa Sari-Sari ${tin}`,
                taxType: "PERCENTAGE",
                birthdate: new Date("1980-01-15"),
                citizenship: "Filipino",
              }
            : {
                kind: "non_individual",
                regName: "HALIMBAWA TRADING CORP",
                businessName: `${TAG} Halimbawa Trading ${tin}`,
                taxType: "VAT",
              }),
          phone,
          tin,
          branch: "00000",
          rdo: "027",
          address: "5 Invented St",
          city: "Lungsod ng Halimbawa",
          zip: "0000",
        },
      })
    ).id;
  }
  async function draft(fx: PreviewFixture, data = fx.data, clientId?: string) {
    const res = await as(http().post(`${API}/bir-forms`)).send({
      clientId: clientId ?? clients[fx.who],
      form: fx.form,
      period: fx.period,
      data,
    });
    expect([fx.form, res.status]).toEqual([fx.form, 201]);
    return res.body.id as string;
  }
  const live = (id: string, body: unknown, t = token) =>
    as(http().post(`${API}/bir-forms/${id}/preview`), t)
      .send(body as object)
      .buffer(true)
      .parse(binary);
  const saved = (id: string) =>
    as(http().post(`${API}/bir-forms/${id}/preview-pdf`))
      .buffer(true)
      .parse(binary);
  /** What a PDF prints, without the footer (it carries the minute). */
  function inkOf(fx: PreviewFixture, pdf: Buffer): string {
    const map = loadMap(`${fx.form}-${map2(fx.form)}.json`);
    const blank = readFileSync(join(BIR_PDF, "templates", map.template));
    const [copy] = readPdfText(new Uint8Array(pdf), blank);
    return JSON.stringify(
      JSON.stringify(copy)
        .split(/"str":"/)
        .filter((p) => !FOOTER.test(p)),
    );
  }
  const VERSIONS: Record<string, string> = {
    "2550Q": "2024-04",
    "1601EQ": "2019-01",
  };
  const map2 = (form: string) => VERSIONS[form] ?? "2018-01";
  /** The body of a JSON answer that came back through the binary parser. */
  const json = (res: request.Response): Json =>
    JSON.parse((res.body as Buffer).toString("utf8"));
  const row = (id: string) => db.birForm.findUniqueOrThrow({ where: { id } });
  const stamp = async (id: string) => ({
    row: await row(id),
    exports: await db.birFormExport.count({ where: { birFormId: id } }),
    audits: await db.auditLog.count({ where: { entityId: id } }),
    objects: storage.objects.size,
  });

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
    const role = async (name: string) =>
      (
        await db.role.findUniqueOrThrow({
          where: { name_scope: { name, scope: "FIRM" } },
        })
      ).id;
    const user = async (fid: string, label: string, roleName: string) => {
      const u = await db.user.create({
        data: {
          firmId: fid,
          userType: "FIRM",
          fullName: `${TAG} ${label}`,
          email: `${TAG}-${label}@example.com`,
          status: "ACTIVE",
          firmProfile: { create: { title: "Test" } },
          userRoles: { create: { roleId: await role(roleName) } },
        },
      });
      return tokens.signAccess({
        id: u.id,
        firmId: fid,
        userType: "FIRM",
        email: u.email,
      });
    };
    firmId = (await db.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } })).id;
    token = await user(firmId, "sa", "Super Admin");
    managerToken = await user(firmId, "manager", "Manager"); // assigned to no client
    const other = await db.firm.create({ data: { name: `${TAG} Ibang Accounting` } });
    otherFirmToken = await user(other.id, "sa2", "Super Admin");
    clients.ind = await newClient("ind", "09170000000", "000555777");
    clients.corp = await newClient("corp", "09170000000", "000555778");
    clients.corpNoPhone = await newClient("corp", null, "000555779");
  });
  beforeEach(() => previewLimiter.reset());
  afterAll(async () => {
    await app.close();
  });

  // ======================================================================================
  describe("T1 · unsaved data prints; nothing is saved", () => {
    it.each(PREVIEW_FIXTURES.map((f) => [f.form, f] as const))(
      "%s: the edit changes the PDF; the saved draft, exports, audit and storage are untouched; the same data prints the same",
      async (_form, fx) => {
        const id = await draft(fx);
        const base = await saved(id);
        expect(base.status).toBe(200);
        const before = await stamp(id);

        const same = await live(id, { data: fx.data });
        expect(same.status).toBe(200);
        expect(same.headers["content-type"]).toMatch(/^application\/pdf/);
        expect(same.headers["cache-control"]).toBe("no-store");
        expect(inkOf(fx, same.body as Buffer)).toBe(inkOf(fx, base.body as Buffer));
        // inline, and the file name the saved Preview has
        const name = (h: string) => /filename="([^"]+)"/.exec(h)![1];
        expect(same.headers["content-disposition"]).toMatch(/^inline;/);
        expect(name(same.headers["content-disposition"]!)).toBe(
          name(base.headers["content-disposition"]!),
        );
        expect(name(same.headers["content-disposition"]!)).toMatch(/-DRAFT\.pdf$/);

        const edited = await live(id, { data: fx.edit(fx.data) });
        expect(edited.status).toBe(200);
        expect(inkOf(fx, edited.body as Buffer)).not.toBe(inkOf(fx, base.body as Buffer));

        const after = await stamp(id);
        expect(after.row.dataJson).toEqual(before.row.dataJson);
        expect(after.row.updatedAt.toISOString()).toBe(
          before.row.updatedAt.toISOString(),
        );
        expect([after.exports, after.audits, after.objects]).toEqual([
          before.exports,
          before.audits,
          before.objects,
        ]);
        // and the saved Preview is still the saved data
        expect(inkOf(fx, (await saved(id)).body as Buffer)).toBe(
          inkOf(fx, base.body as Buffer),
        );
      },
    );

    it("the body replaces the saved data for the render, as PATCH does (it does not merge)", async () => {
      const fx = PREVIEW_FIXTURES.find((f) => f.form === "0619E")!;
      const id = await draft(fx);
      // a body with the amounts left out prints without them, not with the saved ones
      const bare = await live(id, { data: { year: "2026", month: "08", amended: "no" } });
      expect(bare.status).toBe(200);
      const full = await live(id, { data: fx.data });
      expect(inkOf(fx, bare.body as Buffer)).not.toBe(inkOf(fx, full.body as Buffer));
    });
  });

  // ======================================================================================
  describe("T2 · what is refused", () => {
    it.each(PREVIEW_FIXTURES.map((f) => [f.form, f] as const))(
      "%s: a refusal from unsaved data is a 409 with refusals[]; nothing is saved",
      async (_form, fx) => {
        const id = await draft(fx);
        const before = await stamp(id);
        const res = await live(id, { data: fx.bad(fx.data) });
        const body = json(res);
        expect(res.status).toBe(409);
        expect(Object.keys(body).sort()).toEqual([
          "error",
          "message",
          "refusals",
          "statusCode",
        ]);
        expect(body).toMatchObject({ statusCode: 409, error: "Conflict" });
        expect(body.message).toMatch(fx.badMessage);
        expect(body.refusals).toEqual([body.message]);
        // the saved draft prints
        expect((await saved(id)).status).toBe(200);
        const after = await stamp(id);
        expect(after.row.dataJson).toEqual(before.row.dataJson);
        expect([after.exports, after.audits]).toEqual([before.exports, before.audits]);
      },
    );

    it("the contact number is listed first, beside the refusals the form's own data gives", async () => {
      const fx = PREVIEW_FIXTURES.find((f) => f.form === "0619E")!;
      const id = await draft(fx, fx.data, clients.corpNoPhone);
      const only = json(await live(id, { data: fx.data }));
      expect([only.message, only.refusals]).toEqual([CONTACT, [CONTACT]]);
      const both = json(await live(id, { data: fx.bad(fx.data) }));
      expect(both.refusals).toHaveLength(2);
      expect(both.refusals[0]).toBe(CONTACT);
      expect(both.refusals[1]).toMatch(fx.badMessage);
      expect(both.message).toBe(CONTACT);
      // typing a number in the draft (a withholding return) is enough
      const typed = await live(id, { data: { ...fx.data, contact: "0917-000-0000" } });
      expect(typed.status).toBe(200);

      const xml = PREVIEW_FIXTURES.find((f) => f.form === "2551Q")!;
      const noPhoneInd = await newClient("ind", "0917 123 456", "000555780");
      const id2 = await draft(xml, xml.data, noPhoneInd);
      const wrong = json(await live(id2, { data: xml.bad(xml.data) }));
      expect(wrong.refusals[0]).toBe(
        "The client's contact number must be 11 digits, like 09171234567. eBIRForms accepts no other form.",
      );
      expect(wrong.refusals[1]).toMatch(xml.badMessage);
    });

    it("seven ATC rows on the 1601-EQ are refused with the sentence Preview PDF gives", async () => {
      const fx = PREVIEW_FIXTURES.find((f) => f.form === "1601EQ")!;
      const id = await draft(fx);
      const body = json(await live(id, { data: fx.bad(fx.data) }));
      expect(body.message).toBe("7 ATCs; the form has six rows.");
      expect(body.refusals).toEqual(["7 ATCs; the form has six rows."]);
    });

    it("a body PATCH would refuse is a 400 with PATCH's own messages", async () => {
      const fx = PREVIEW_FIXTURES.find((f) => f.form === "2551Q")!;
      const id = await draft(fx);
      for (const bad of [{}, { data: "x" }, { data: [1] }, { data: null }, "x"]) {
        const res = await live(id, bad);
        const body = json(res);
        expect([JSON.stringify(bad), res.status]).toEqual([JSON.stringify(bad), 400]);
        expect(body.message).toBe("Validation failed");
        expect(body.errors).toEqual([expect.objectContaining({ path: "data" })]);
        const patch = await as(http().patch(`${API}/bir-forms/${id}`)).send(
          typeof bad === "object" ? { data: (bad as Json).data } : {},
        );
        if ((bad as Json)?.data !== undefined && (bad as Json)?.data !== null) {
          expect(patch.status).toBe(400);
          expect(patch.body.message).toBe(body.message);
          expect(patch.body.errors).toEqual(body.errors);
        }
      }
      const source = json(
        await live(id, { data: { ...fx.data, _source: { nonsense: true } } }),
      );
      const patched = await as(http().patch(`${API}/bir-forms/${id}`)).send({
        data: { ...fx.data, _source: { nonsense: true } },
      });
      expect(patched.status).toBe(400);
      expect(source.message).toBe(patched.body.message);
      expect(source.message).toMatch(/^The draft's _source isn't valid\./);
    });

    it.each(PREVIEW_FIXTURES.map((f) => [f.form, f] as const))(
      "%s: a filed return ignores the body and answers what Preview PDF answers",
      async (_form, fx) => {
        const filed = await db.birForm.create({
          data: {
            firmId,
            clientId: clients[fx.who],
            form: fx.form,
            period: `${fx.period}-F`.slice(0, fx.period.length),
            status: "filed",
            filedAt: new Date("2026-08-05T02:00:00.000Z"),
            dataJson: fx.data as object,
          },
        });
        const today = await saved(filed.id);
        for (const body of [{ data: fx.edit(fx.data) }, { data: "garbage" }, {}, null]) {
          const res = await live(filed.id, body);
          expect([res.status, json(res).message]).toEqual([409, json(today).message]);
          expect(json(res).message).toBe(PREVIEW_FILED);
          expect(json(res).refusals).toEqual([PREVIEW_FILED]);
        }
        expect((await row(filed.id)).dataJson).toEqual(fx.data);
      },
    );

    it("the 2316 has no Preview: the sentence Preview PDF gives, with refusals[]", async () => {
      const id = (
        await as(http().post(`${API}/bir-forms`)).send({
          clientId: clients.corp,
          form: "2316",
          period: "2026",
          data: {},
        })
      ).body.id as string;
      const today = await saved(id);
      const res = await live(id, { data: {} });
      expect([res.status, json(res).message]).toEqual([409, json(today).message]);
      expect(json(res).message).toBe("A preview of the 2316 is not available yet.");
      expect(json(res).refusals).toEqual(["A preview of the 2316 is not available yet."]);
    });

    it("the permission is Preview PDF's: a firm user not assigned to the client gets 403, as for Preview PDF", async () => {
      const fx = PREVIEW_FIXTURES[0]!;
      const id = await draft(fx);
      const today = await as(
        http().post(`${API}/bir-forms/${id}/preview-pdf`),
        managerToken,
      );
      const res = await live(id, { data: fx.data }, managerToken);
      expect([today.status, res.status]).toEqual([403, 403]);
    });

    it("another firm's return is a 404, and it renders nothing", async () => {
      const fx = PREVIEW_FIXTURES[0]!;
      const id = await draft(fx);
      const res = await live(id, { data: fx.data }, otherFirmToken);
      expect(res.status).toBe(404);
      expect((await live(randomUUID(), { data: fx.data })).status).toBe(404);
    });
  });

  // ======================================================================================
  describe("T3 · the limit: 40 a minute per user", () => {
    it("the 41st preview inside a minute is a 429 with its sentence; another user is not limited; a minute later it works again", async () => {
      const fx = PREVIEW_FIXTURES.find((f) => f.form === "2551Q")!;
      const filed = await db.birForm.create({
        data: {
          firmId,
          clientId: clients.ind,
          form: "2551Q",
          period: "2025-Q1",
          status: "filed",
          filedAt: new Date("2026-08-05T02:00:00.000Z"),
          dataJson: fx.data as object,
        },
      });
      const realNow = Date.now;
      let now = realNow();
      jest.spyOn(Date, "now").mockImplementation(() => now);
      try {
        for (let i = 1; i <= 40; i++) {
          const r = await live(filed.id, { data: {} });
          if (r.status !== 409) throw new Error(`preview ${i} answered ${r.status}`);
        }
        const over = await live(filed.id, { data: {} });
        expect(over.status).toBe(429);
        expect(json(over)).toEqual({
          statusCode: 429,
          error: "Too Many Requests",
          message: TOO_MANY,
        });
        // another user has his own count
        expect((await live(filed.id, { data: {} }, otherFirmToken)).status).toBe(404);
        // a minute later
        now += 61_000;
        expect((await live(filed.id, { data: {} })).status).toBe(409);
      } finally {
        jest.restoreAllMocks();
      }
    });
  });

  // ======================================================================================
  describe("T4 · how long a render takes (median of 3), for the pane's delay", () => {
    it("prints the time per form", async () => {
      const rows: string[] = [];
      for (const fx of PREVIEW_FIXTURES) {
        const id = await draft(fx);
        const times: number[] = [];
        for (let i = 0; i < 3; i++) {
          previewLimiter.reset();
          const t0 = process.hrtime.bigint();
          const res = await live(id, { data: fx.edit(fx.data) });
          times.push(Number(process.hrtime.bigint() - t0) / 1e6);
          expect(res.status).toBe(200);
        }
        times.sort((a, b) => a - b);
        rows.push(
          `U23-TIMING ${fx.form} ${Math.round(times[1]!)} ms (runs ${times.map(Math.round).join("/")})`,
        );
      }
      // eslint-disable-next-line no-console
      console.log(rows.join("\n"));
    }, 120_000);
  });
});
