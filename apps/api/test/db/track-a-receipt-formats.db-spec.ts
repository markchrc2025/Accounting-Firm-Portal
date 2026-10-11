/**
 * track-a-receipt-formats.db-spec.ts — U11-A1 against the real Nest app over HTTP and
 * the local PostgreSQL, with a FAKE Anthropic batch client and in-memory storage:
 * nothing here calls the real API. Every firm and client is invented; every file is
 * a fixture generated in a VM (test/fixtures/receipts/make-fixtures.py): plain
 * colour blocks, never a real receipt or photo.
 *
 * T1  Every photo format a client sends, iPhone HEIC included, is read by its
 *     content, prepared to a JPEG with no EXIF, and sent.
 * T2  A video, a camera RAW file, a Word document and random bytes are refused with
 *     a 400 naming the file and what it looks like; nothing is stored or sent.
 * T3  Uploads wait on disk, not in memory, and no temporary file is left behind:
 *     after a pile is sent, refused over budget (409), refused by the batch API
 *     (502), refused for a file (400), or refused by multer (a file over 10 MB).
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import sharp from "sharp";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { ReceiptScanPreparer } from "../../src/ai/receipt-scan.preparer";
import { SCAN_UPLOAD_DIR } from "../../src/ai/scan-upload.interceptor";
import { StorageService } from "../../src/storage/storage.service";

process.env.ANTHROPIC_API_KEY = "sk-ant-u11a1-FAKE-KEY-0123456789";

truncateOncePerFile({ firmRoles: ["Super Admin"], chartOfAccounts: true });

const TAG = `track-a-receipt-formats-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const FIXTURES = join(__dirname, "..", "fixtures", "receipts");
const fixture = (name: string) => readFileSync(join(FIXTURES, name));

type BatchRequest = { custom_id: string; params: Record<string, unknown> };

/** Every file under the upload folder (U14: a pile waits in piles/<id>/). */
const filesOnDisk = () =>
  readdirSync(SCAN_UPLOAD_DIR, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);

/** A fake Anthropic Message Batches client: it records every batch it is asked to
 *  create, and can be told to refuse one. Nothing is ever read back. */
class FakeBatchClient {
  creates: BatchRequest[][] = [];
  refuse = false;
  /** T3: how many uploads were waiting on disk while each batch was created. */
  onDisk: number[] = [];
  async createBatch(requests: BatchRequest[]) {
    this.onDisk.push(filesOnDisk().length);
    if (this.refuse) throw new Error("batch refused (fake)");
    this.creates.push(requests);
    return { id: `msgbatch_formats_${this.creates.length}` };
  }
  async retrieveBatch(id: string) {
    return { id, processing_status: "in_progress" };
  }
  // eslint-disable-next-line require-yield -- nothing is ever collected here
  async *batchResults(): AsyncIterable<never> {
    return;
  }
}

/** In-memory object storage standing in for S3. */
class FakeStorage {
  objects = new Map<string, { body: Uint8Array; contentType: string }>();
  isEnabled() {
    return true;
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

/** The image a request sends, decoded from its base64. */
function sentImage(r: BatchRequest): Buffer {
  const messages = r.params.messages as Array<{
    content: Array<{ type: string; source?: { media_type: string; data: string } }>;
  }>;
  const block = messages[0]!.content.find((c) => c.type === "image");
  expect(block?.source?.media_type).toBe("image/jpeg");
  return Buffer.from(block!.source!.data, "base64");
}

type Rgb = [number, number, number];
const isRed = ([r, g, b]: Rgb) => r > 150 && g < 100 && b < 100;
const isGrey = ([r, g, b]: Rgb) =>
  Math.max(r, g, b) - Math.min(r, g, b) < 40 && r > 90 && r < 170;
const isBlue = ([r, g, b]: Rgb) => b > 150 && r < 110 && g < 130;
const isWhite = ([r, g, b]: Rgb) => r > 225 && g > 225 && b > 225;

/** The colour at a fraction of the picture's width and height. */
async function colourAt(jpeg: Buffer, fx: number, fy: number): Promise<Rgb> {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const x = Math.floor(info.width * fx);
  const y = Math.floor(info.height * fy);
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!];
}

describe("U11-A1 · every photo format a client sends (real app over HTTP, db, fake Anthropic client)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  const fake = new FakeBatchClient();
  const storage = new FakeStorage();
  let firmId = "";
  let clientId = "";
  let saToken = "";

  /** POST a pile; U14 R3: it answers 202 "preparing", so wait for the background
   *  step before the test looks at what was sent. */
  const pile = async (files: Array<{ name: string; body: Buffer; type: string }>) => {
    let r = request(app.getHttpServer())
      .post(
        `${API}/receipt-scans?clientId=${clientId}&periodFrom=2026-07-01&periodTo=2026-09-30`,
      )
      .set("Authorization", `Bearer ${saToken}`);
    for (const f of files)
      r = r.attach("files", f.body, { filename: f.name, contentType: f.type });
    const res = await r;
    if (res.status === 202) await app.get(ReceiptScanPreparer).idle();
    return res;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .overrideProvider("AiBatchClient")
      .useValue(fake)
      .overrideProvider("AiClock")
      .useValue({ now: () => new Date("2026-10-10T02:00:00.000Z") })
      .overrideProvider("AiPollerTimer")
      .useValue({ setTimer: () => undefined, clearTimer: () => undefined })
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
          businessName: `${TAG} Invented Trading`,
          regName: "INVENTED TRADING CORP",
          tin: "000555777",
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
    saToken = app
      .get(TokenService)
      .signAccess({ id: sa.id, firmId, userType: "FIRM", email: sa.email });
  });

  afterAll(async () => {
    await app.close();
  });

  // --- T1 -------------------------------------------------------------------------

  it("T1 · HEIC (plain, rotated, two images), PNG, WebP, GIF, TIFF, BMP, AVIF and a JPEG named photo.dat: all read by content, sent as JPEG with no EXIF", async () => {
    const files = [
      { name: "IMG_0101.HEIC", body: fixture("heic-plain.heic"), type: "image/heic" },
      {
        name: "IMG_0102.HEIC",
        body: fixture("heic-irot90.heic"),
        type: "application/octet-stream",
      },
      { name: "IMG_0103", body: fixture("heic-two-images.heic"), type: "image/heif" },
      { name: "scan.png", body: fixture("photo.png"), type: "image/png" },
      { name: "scan.webp", body: fixture("photo.webp"), type: "image/webp" },
      { name: "scan.gif", body: fixture("photo.gif"), type: "image/gif" },
      { name: "scan.tiff", body: fixture("photo.tiff"), type: "image/tiff" },
      { name: "scan.bmp", body: fixture("photo.bmp"), type: "image/bmp" },
      { name: "scan.avif", body: fixture("photo.avif"), type: "image/avif" },
      { name: "photo.dat", body: fixture("photo.dat"), type: "application/octet-stream" },
    ];
    const res = await pile(files);
    // U14 R3: 202 "preparing", then prepared in the background.
    expect([res.status, res.body.message]).toEqual([202, undefined]);
    expect(res.body.files).toBe(10);

    // Every file was sent, in one batch, as a JPEG.
    const sent = fake.creates.at(-1)!;
    expect(sent).toHaveLength(10);
    const rows = await writer.receiptScanFile.findMany({
      where: { scanId: res.body.id },
      orderBy: { position: "asc" },
    });
    expect(rows.map((r) => r.name)).toEqual(files.map((f) => f.name));
    const byName = new Map<string, Buffer>();
    for (const row of rows) {
      const r = sent.find((q) => q.custom_id === row.id)!;
      const jpeg = sentImage(r);
      byName.set(row.name, jpeg);
      // What is stored is what is sent: the same prepared JPEG.
      const stored = storage.objects.get(row.storageKey!)!;
      expect(stored.contentType).toBe("image/jpeg");
      expect(Buffer.from(stored.body).equals(jpeg)).toBe(true);
      expect(row.contentType).toBe("image/jpeg");
      const meta = await sharp(jpeg).metadata();
      expect([row.name, meta.format]).toEqual([row.name, "jpeg"]);
      // No EXIF (so no GPS and no orientation), no XMP.
      expect([row.name, meta.exif, meta.xmp, meta.orientation]).toEqual([
        row.name,
        undefined,
        undefined,
        undefined,
      ]);
      expect([row.width, row.height]).toEqual([meta.width, meta.height]);
    }

    const size = async (n: string) => {
      const m = await sharp(byName.get(n)!).metadata();
      return [m.width, m.height];
    };
    const at = (n: string, fx: number, fy: number) => colourAt(byName.get(n)!, fx, fy);

    // The plain HEIC: 320×240, its marker top-left.
    expect(await size("IMG_0101.HEIC")).toEqual([320, 240]);
    expect(isRed(await at("IMG_0101.HEIC", 0.1, 0.1))).toBe(true);
    // The rotated HEIC is encoded 320×240 with a quarter turn (irot): it comes out
    // upright at 240×320, the encoded top-left corner now bottom-left.
    expect(await size("IMG_0102.HEIC")).toEqual([240, 320]);
    expect(isRed(await at("IMG_0102.HEIC", 0.1, 0.9))).toBe(true);
    expect(isGrey(await at("IMG_0102.HEIC", 0.1, 0.1))).toBe(true);
    // The two-image HEIC: its primary (the second, 200×300 blue), not its first.
    expect(await size("IMG_0103")).toEqual([200, 300]);
    expect(isBlue(await at("IMG_0103", 0.5, 0.5))).toBe(true);
    expect(isRed(await at("IMG_0103", 0.1, 0.1))).toBe(true);

    for (const n of [
      "scan.png",
      "scan.webp",
      "scan.gif",
      "scan.tiff",
      "scan.bmp",
      "scan.avif",
      "photo.dat",
    ]) {
      expect([n, await size(n)]).toEqual([n, [300, 200]]);
      expect([n, isRed(await at(n, 0.1, 0.1))]).toEqual([n, true]);
    }
    // GIF and TIFF: the first frame and page (grey), not the second (blue).
    expect(isGrey(await at("scan.gif", 0.5, 0.5))).toBe(true);
    expect(isGrey(await at("scan.tiff", 0.5, 0.5))).toBe(true);
    // A transparent PNG background comes out white, not black.
    expect(isWhite(await at("scan.png", 0.5, 0.5))).toBe(true);
  });

  // --- T2 -------------------------------------------------------------------------

  it.each([
    ["clip.mp4", "video/mp4", "a video"],
    ["raw.dng", "image/x-adobe-dng", "a camera RAW file"],
    [
      "letter.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "a Word document",
    ],
    ["noise.bin", "application/octet-stream", "an unknown file"],
  ])(
    "T2 · %s is refused with a 400 naming it and what it looks like; nothing stored or sent",
    async (file, type, kind) => {
      const before = {
        scans: await writer.receiptScan.count({ where: { firmId } }),
        objects: storage.objects.size,
        creates: fake.creates.length,
      };
      const name = `upload-${file}`;
      const res = await pile([
        { name: "fine.jpg", body: fixture("photo.dat"), type: "image/jpeg" },
        { name, body: fixture(file), type },
      ]);
      expect([res.status, res.body.message]).toEqual([
        400,
        `${name} is not a photo or PDF the Portal can read (it looks like ${kind}).`,
      ]);
      expect({
        scans: await writer.receiptScan.count({ where: { firmId } }),
        objects: storage.objects.size,
        creates: fake.creates.length,
      }).toEqual(before);
    },
  );

  // --- T3 -------------------------------------------------------------------------

  describe("T3 · uploads wait on disk, and no temporary file is left behind", () => {
    const left = filesOnDisk;
    const three = (tag: string) =>
      ["photo.png", "photo.webp", "heic-plain.heic"].map((f) => ({
        name: `${tag}-${f}`,
        // Distinct bytes per pile, so no file is an exact copy of an earlier one.
        body: Buffer.concat([fixture(f), Buffer.from(tag)]),
        type: "application/octet-stream",
      }));

    it("after a pile is sent: its 3 files were on disk while it was sent, and are gone", async () => {
      expect(left()).toEqual([]);
      const res = await pile(three("sent"));
      expect(res.status).toBe(202); // U14 R3
      expect(fake.onDisk.at(-1)).toBe(3);
      expect(left()).toEqual([]);
    });

    it("after the batch API refuses the pile (U14: the pile ends failed)", async () => {
      fake.refuse = true;
      try {
        const res = await pile(three("refused"));
        expect(res.status).toBe(202); // U14 R3: refused in the background
        expect(
          (await writer.receiptScan.findUniqueOrThrow({ where: { id: res.body.id } }))
            .status,
        ).toBe("failed");
        expect(fake.onDisk.at(-1)).toBe(3);
      } finally {
        fake.refuse = false;
      }
      expect(left()).toEqual([]);
    });

    it("after a pile is refused for one of its files (400)", async () => {
      const res = await pile([
        ...three("bad-file"),
        { name: "clip.mp4", body: fixture("clip.mp4"), type: "video/mp4" },
      ]);
      expect(res.status).toBe(400);
      expect(left()).toEqual([]);
    });

    it("after multer refuses a file over 10 MB (400)", async () => {
      const res = await pile([
        ...three("too-big"),
        {
          name: "huge.jpg",
          body: Buffer.concat([fixture("photo.dat"), Buffer.alloc(10 * 1024 * 1024)]),
          type: "image/jpeg",
        },
      ]);
      expect([res.status, res.body.message]).toEqual([
        400,
        "One of the files is larger than 10 MB. Each file must be 10 MB or smaller.",
      ]);
      expect(left()).toEqual([]);
    });

    it("after a pile is refused over budget (409)", async () => {
      const sa = await writer.user.findFirstOrThrow({ where: { firmId } });
      await writer.receiptScan.create({
        data: {
          firmId,
          clientId,
          periodFrom: new Date("2026-07-01T00:00:00.000Z"),
          periodTo: new Date("2026-09-30T00:00:00.000Z"),
          status: "ready",
          model: "claude-sonnet-5-5",
          promptVersion: "receipts-v1",
          month: "2026-10",
          batchId: `msgbatch_spent_${randomUUID()}`,
          estimatedUsd: 24.99,
          actualUsd: 24.99,
          createdById: sa.id,
        },
      });
      const creates = fake.creates.length;
      const res = await pile(three("over-budget"));
      expect(res.status).toBe(409);
      expect(fake.creates.length).toBe(creates);
      expect(left()).toEqual([]);
    });
  });
});
