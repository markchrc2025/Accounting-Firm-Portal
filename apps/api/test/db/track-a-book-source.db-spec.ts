/**
 * track-a-book-source.db-spec.ts — U15 R5, over HTTP against the real Nest app and the
 * local PostgreSQL, with an in-memory object store. A draft's data may carry the
 * optional `_source` key (where its figures came from). It is saved and returned like
 * any other key, a malformed one is refused in a sentence, and the XML export, the
 * clear copy and the Preview PDF ignore it: their bytes are the same with it and
 * without it. Every firm, client and figure is invented.
 *
 * T3  _source is kept on read; the three outputs are byte-identical with and without
 *     it, for a draft and a filed 2551Q and 2550Q; a malformed one is refused.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-book-source-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";

/** In-memory object storage standing in for S3; keys carry the form id. */
class FakeStorage {
  objects = new Map<string, { body: Uint8Array; contentType: string }>();
  isEnabled() {
    return true;
  }
  birFormExportKey(firmId: string, birFormId: string, filename: string) {
    return `bir-forms/${firmId}/${birFormId}/${filename}`;
  }
  async putObject(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, { body, contentType });
  }
  async deleteObject(key: string) {
    this.objects.delete(key);
  }
  async signedGetUrl(key: string) {
    return `https://storage.test/${key}?signed=1`;
  }
}

/** supertest: collect a binary body as a Buffer. */
function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

const FIGURES_2551Q = {
  year: "2026",
  quarter: "3rd",
  amended: "no",
  periodType: "calendar",
  taxRelief: "no",
  itRate: "graduated",
  rows: [
    { atc: "PT010", taxable: "120000", rate: "3" },
    { atc: "PT040", taxable: "50001", rate: "3" },
  ],
  i15: "1500",
  i20: "100",
};
const FIGURES_2550Q = {
  year: "2026",
  periodType: "calendar",
  amended: "no",
  i31a: "600000",
  i32a: "250001",
  i33a: "1",
  i16: "3001",
  i44a: "100000",
  i44b: "12000",
  i45a: "10000",
  i45b: "1200",
  i46a: "30001",
  i46b: "3600",
  i47a: "5000",
  i47b: "600",
  i48a: "7000",
  i49a: "4001",
};
const SOURCE = {
  mode: "books",
  asOf: "2026-10-12T01:02:03.000Z",
  fed: {
    i31a: "600000",
    i33a: "1",
    rows: [{ atc: "PT010", taxable: "120000", rate: "3" }],
  },
  edited: ["i33a", "rows"],
};

describe("U15 R5 · _source rides with a draft and changes nothing it prints (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  const storage = new FakeStorage();
  let firmId = "";
  let clientId = "";
  let token = "";

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
  const preview = (id: string) =>
    as(http().post(`${API}/bir-forms/${id}/preview-pdf`))
      .buffer(true)
      .parse(binary);

  async function make(form: string, data: Record<string, unknown>, period = "2026-Q3") {
    const res = await as(http().post(`${API}/bir-forms`)).send({
      clientId,
      form,
      period,
      data,
    });
    expect(res.status).toBe(201);
    return res.body as { id: string; data: Record<string, unknown> };
  }
  async function file(id: string) {
    const res = await as(http().patch(`${API}/bir-forms/${id}`)).send({
      status: "filed",
    });
    expect(res.status).toBe(200);
  }
  /** The stored bytes of an export the API just made. */
  const stored = (id: string, filename: string) => {
    const hit = storage.objects.get(`bir-forms/${firmId}/${id}/${filename}`);
    if (!hit) throw new Error(`${filename} was not stored for ${id}`);
    return Buffer.from(hit.body);
  };
  async function xmlOf(id: string) {
    const res = await as(http().post(`${API}/bir-forms/${id}/export`));
    expect(res.status).toBe(201);
    return {
      filename: res.body.filename as string,
      bytes: stored(id, res.body.filename),
    };
  }
  async function clearCopyOf(id: string) {
    const res = await as(http().post(`${API}/bir-forms/${id}/clear-copy`));
    expect(res.status).toBe(201);
    return {
      filename: res.body.filename as string,
      bytes: stored(id, res.body.filename),
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    writer = app.get(PrismaService);
    firmId = (await writer.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } }))
      .id;
    clientId = (
      await writer.client.create({
        data: {
          firmId,
          businessName: `${TAG} Halimbawa Tindahan`,
          kind: "individual",
          lastName: "HALIMBAWA",
          firstName: "PEDRO",
          middleName: "SUBOK",
          tin: "000555888",
          branch: "00000",
          rdo: "027",
          address: "7 Invented St",
          city: "Lungsod ng Halimbawa",
          zip: "0000",
          taxType: "VAT",
        },
      })
    ).id;
    const sa = await writer.user.create({
      data: {
        firmId,
        userType: "FIRM",
        fullName: `${TAG} super admin`,
        email: `${TAG}-sa@example.com`,
        status: "ACTIVE",
        firmProfile: { create: { title: "Test" } },
        userRoles: {
          create: {
            roleId: (
              await writer.role.findUniqueOrThrow({
                where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
              })
            ).id,
          },
        },
      },
    });
    token = app
      .get(TokenService)
      .signAccess({ id: sa.id, firmId, userType: "FIRM", email: sa.email });
  });

  afterAll(async () => {
    await app.close();
  });

  it("a draft saved with _source returns it unchanged, on create, on read and on update; a draft without one has none", async () => {
    const created = await make("2550Q", { ...FIGURES_2550Q, _source: SOURCE });
    expect(created.data["_source"]).toEqual(SOURCE);
    const read = await as(http().get(`${API}/bir-forms/${created.id}`));
    expect(read.status).toBe(200);
    expect(read.body.data._source).toEqual(SOURCE);
    // The figures are untouched by it: the computed block is the same with and without.
    const plain = await make("2550Q", FIGURES_2550Q);
    expect(plain.data["_source"]).toBeUndefined();
    const readPlain = await as(http().get(`${API}/bir-forms/${plain.id}`));
    expect(read.body.computed).toEqual(readPlain.body.computed);

    // An update replaces the data, _source included: the user's later edit is kept.
    const edited = { ...SOURCE, edited: ["i33a", "i16"] };
    const updated = await as(http().patch(`${API}/bir-forms/${created.id}`)).send({
      data: { ...FIGURES_2550Q, i16: "9999", _source: edited },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data._source).toEqual(edited);
    // And dropping it makes the draft a manual one again.
    const dropped = await as(http().patch(`${API}/bir-forms/${created.id}`)).send({
      data: FIGURES_2550Q,
    });
    expect(dropped.body.data._source).toBeUndefined();

    // POST /bir-forms/compute takes it and ignores it.
    const withSource = await as(http().post(`${API}/bir-forms/compute`)).send({
      form: "2550Q",
      data: { ...FIGURES_2550Q, _source: SOURCE },
    });
    const without = await as(http().post(`${API}/bir-forms/compute`)).send({
      form: "2550Q",
      data: FIGURES_2550Q,
    });
    expect([withSource.status, without.status]).toEqual([201, 201]);
    expect(withSource.body).toEqual(without.body);
  });

  describe.each([
    ["2551Q", FIGURES_2551Q],
    ["2550Q", FIGURES_2550Q],
  ] as const)("the %s", (form, figures) => {
    it("a draft: the XML export and the Preview PDF are byte-identical with and without _source; the clear copy is refused alike", async () => {
      const without = await make(form, figures);
      const withSource = await make(form, { ...figures, _source: SOURCE });

      const a = await xmlOf(without.id);
      const b = await xmlOf(withSource.id);
      expect(b.filename).toBe(a.filename);
      expect(b.bytes.length).toBeGreaterThan(500);
      expect(b.bytes.equals(a.bytes)).toBe(true);

      // The Preview PDF's footer carries the time to the minute; a pair is compared
      // only when a second print of the first draft (taken after) shows the clock
      // did not tick across the pair.
      let compared = false;
      for (let attempt = 0; attempt < 5 && !compared; attempt++) {
        const pa = await preview(without.id);
        const pb = await preview(withSource.id);
        const pa2 = await preview(without.id);
        expect([pa.status, pb.status, pa2.status]).toEqual([200, 200, 200]);
        if ((pa.body as Buffer).equals(pa2.body as Buffer)) {
          expect((pb.body as Buffer).equals(pa.body as Buffer)).toBe(true);
          expect((pa.body as Buffer).subarray(0, 5).toString("latin1")).toBe("%PDF-");
          compared = true;
        }
      }
      expect(compared).toBe(true);

      const ca = await as(http().post(`${API}/bir-forms/${without.id}/clear-copy`));
      const cb = await as(http().post(`${API}/bir-forms/${withSource.id}/clear-copy`));
      expect([ca.status, ca.body.message]).toEqual([cb.status, cb.body.message]);
      expect(ca.status).toBe(409);

      // The comparison can tell: a different figure is a different export.
      const other = await make(form, {
        ...figures,
        ...(form === "2551Q" ? { i15: "1501" } : { i31a: "600001" }),
      });
      expect((await xmlOf(other.id)).bytes.equals(a.bytes)).toBe(false);
    });

    it("a filed return: the XML export and the clear copy are byte-identical with and without _source; the Preview PDF is refused alike", async () => {
      const without = await make(form, figures);
      const withSource = await make(form, { ...figures, _source: SOURCE });
      await file(without.id);
      await file(withSource.id);

      // The source is part of what was filed, and is returned with it.
      const read = await as(http().get(`${API}/bir-forms/${withSource.id}`));
      expect(read.body.status).toBe("filed");
      expect(read.body.data._source).toEqual(SOURCE);

      const a = await xmlOf(without.id);
      const b = await xmlOf(withSource.id);
      expect(b.filename).toBe(a.filename);
      expect(b.bytes.equals(a.bytes)).toBe(true);

      const ca = await clearCopyOf(without.id);
      const cb = await clearCopyOf(withSource.id);
      expect(cb.filename).toBe(ca.filename);
      expect(cb.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(cb.bytes.equals(ca.bytes)).toBe(true);

      const pa = await preview(without.id);
      const pb = await preview(withSource.id);
      expect(pa.status).toBe(409);
      expect(pb.status).toBe(409);
    });
  });

  it("a filed return is sealed whatever PATCH sends: 409, even with a malformed _source", async () => {
    const filed = await make("2550Q", FIGURES_2550Q);
    await file(filed.id);
    for (const data of [
      { ...FIGURES_2550Q, _source: SOURCE },
      { ...FIGURES_2550Q, _source: "x" },
    ]) {
      const res = await as(http().patch(`${API}/bir-forms/${filed.id}`)).send({ data });
      expect(res.status).toBe(409);
    }
    const read = await as(http().get(`${API}/bir-forms/${filed.id}`));
    expect(read.body.data._source).toBeUndefined();
  });

  it("a malformed _source is refused with a clear message, on create and on update, and nothing is saved", async () => {
    const before = await writer.birForm.count({ where: { clientId } });
    const good = await make("2550Q", FIGURES_2550Q);
    const after = before + 1;

    const bad: Array<[string, unknown, string]> = [
      ["a mode that is neither", { ...SOURCE, mode: "auto" }, "mode"],
      ["no asOf", { mode: "books", fed: {}, edited: [] }, "asOf"],
      ["an asOf that is not a time", { ...SOURCE, asOf: "yesterday" }, "asOf"],
      ["edited that is not a list", { ...SOURCE, edited: "i31a" }, "edited"],
      ["fed that is a list", { ...SOURCE, fed: ["i31a"] }, "fed"],
      ["a source that is a word", "books", "_source"],
      ["a source that is null", null, "_source"],
    ];
    for (const [, source, where] of bad) {
      const created = await as(http().post(`${API}/bir-forms`)).send({
        clientId,
        form: "2550Q",
        period: "2026-Q3",
        data: { ...FIGURES_2550Q, _source: source },
      });
      expect(created.status).toBe(400);
      expect(created.body.message).toMatch(/^The draft's _source isn't valid\. /);
      if (where !== "_source") expect(created.body.message).toContain(where);

      const updated = await as(http().patch(`${API}/bir-forms/${good.id}`)).send({
        data: { ...FIGURES_2550Q, _source: source },
      });
      expect(updated.status).toBe(400);
      expect(updated.body.message).toMatch(/^The draft's _source isn't valid\. /);
    }
    expect(await writer.birForm.count({ where: { clientId } })).toBe(after);
    const still = await as(http().get(`${API}/bir-forms/${good.id}`));
    expect(still.body.data["_source"]).toBeUndefined();
    expect(still.body.data.i31a).toBe("600000");
  });
});
