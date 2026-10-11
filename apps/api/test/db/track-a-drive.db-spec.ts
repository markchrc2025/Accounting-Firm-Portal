/**
 * track-a-drive.db-spec.ts — U14 against the real Nest app over HTTP and the local
 * PostgreSQL, with a FAKE Google Drive, a FAKE Anthropic batch client and in-memory
 * storage: nothing here reaches Google or Anthropic. Every firm, client, folder and
 * file is invented; every picture is a fixture generated in a VM.
 *
 * T1  A client's Drive folder is linked; its photos and PDFs are listed (subfolders
 *     with their path, a Google Docs file with its problem); three are sent as a
 *     pile, which answers 202 "preparing" and is prepared in the background exactly
 *     as an upload is — but nothing reaches the bucket; each file has a Drive link
 *     and a signed image link that serves a JPEG or the PDF; a second listing marks
 *     the three already read.
 * T3  The robot's key: absent, broken, refused and API-not-enabled each give their
 *     status; pasted with its line breaks stripped, or as base64, it works; the
 *     private key appears in no response, log line or audit row. (The real Google
 *     client signs its own token; a fake fetch stands in for Google.)
 * T4  The background: 20 HEICs answer 202 at once and are prepared; a pile a
 *     restart left "preparing" is ended after 30 minutes with its reservation
 *     released and no temporary file left; over budget once prepared ends failed
 *     with nothing sent.
 */
import { createVerify, generateKeyPairSync, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { pileDir } from "../../src/ai/receipt-scan.service";
import { DriveError } from "../../src/drive/drive-api";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

process.env.ANTHROPIC_API_KEY = "sk-ant-u14-FAKE-KEY-0123456789";
process.env.API_PUBLIC_URL = "https://api.invented.test";

truncateOncePerFile({ firmRoles: ["Super Admin"], chartOfAccounts: true });

const TAG = `track-a-drive-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const FIXTURES = join(__dirname, "..", "fixtures", "receipts");
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const ROBOT = "portal-robot@invented-project.iam.gserviceaccount.com";

type BatchRequest = { custom_id: string; params: Record<string, unknown> };

class FakeBatchClient {
  creates: BatchRequest[][] = [];
  async createBatch(requests: BatchRequest[]) {
    this.creates.push(requests);
    return { id: `msgbatch_drive_${this.creates.length}` };
  }
  async retrieveBatch(id: string) {
    return { id, processing_status: "in_progress" };
  }
  // eslint-disable-next-line require-yield -- nothing is ever collected here
  async *batchResults(): AsyncIterable<never> {
    return;
  }
}

class FakeStorage {
  objects = new Map<string, Uint8Array>();
  puts = 0;
  isEnabled() {
    return true;
  }
  async putObject(key: string, body: Uint8Array) {
    this.puts++;
    this.objects.set(key, body);
  }
  async deleteObject(key: string) {
    this.objects.delete(key);
  }
  async signedGetUrl(key: string) {
    return `https://storage.test/${key}?signed=1`;
  }
}

interface FakeItem {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string;
  parent: string | null;
  bytes?: Buffer;
}

/** A fake Google Drive: a tree of invented folders and files. Its interface is the
 *  Portal's DriveApi, which has reads only; every call is recorded. */
class FakeDrive {
  calls: string[] = [];
  items = new Map<string, FakeItem>();
  add(item: Omit<FakeItem, "size"> & { size?: number }) {
    this.items.set(item.id, {
      ...item,
      size: item.size ?? item.bytes?.length ?? null,
    });
  }
  async status() {
    this.calls.push("status");
    return { configured: true, robotEmail: ROBOT, problem: null };
  }
  async getFile(id: string) {
    this.calls.push(`getFile ${id}`);
    const it = this.items.get(id);
    return it ? this.view(it) : null;
  }
  /** When set, every listing is refused by Google with this. */
  refuse: Error | null = null;
  async listFolder(id: string) {
    this.calls.push(`listFolder ${id}`);
    if (this.refuse) throw this.refuse;
    return [...this.items.values()]
      .filter((i) => i.parent === id)
      .map((i) => this.view(i));
  }
  async download(id: string, dest: string, maxBytes: number) {
    this.calls.push(`download ${id}`);
    const it = this.items.get(id);
    if (!it?.bytes) return "gone" as const;
    if (it.bytes.length > maxBytes) return "too-large" as const;
    writeFileSync(dest, it.bytes);
    return "ok" as const;
  }
  private view(i: FakeItem) {
    return {
      id: i.id,
      name: i.name,
      mimeType: i.mimeType,
      size: i.size,
      modifiedTime: i.modifiedTime,
      parents: i.parent ? [i.parent] : [],
    };
  }
}

const FOLDER = "1InventedFolderAbcdefghij";
const SUB = "1InventedSubfolderKlmnop";
const HEIC = "1InventedHeicFileQrstuvw";
const JPEG = "1InventedJpegFileXyzabcd";
const PDF = "1InventedPdfFileEfghijkl";
const DOCS = "1InventedDocsFileMnopqrs";

async function pdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 300]);
  return Buffer.from(await doc.save());
}

describe("U14 · receipt photos stay in Google Drive (real app over HTTP, db, fake Drive, fake Anthropic)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  const fake = new FakeBatchClient();
  const storage = new FakeStorage();
  const drive = new FakeDrive();
  let clockNow = new Date("2026-10-11T02:00:00.000Z");
  let firmId = "";
  let clientId = "";
  let token = "";
  const timers: Array<{ fn: () => void; ms: number }> = [];

  const http = () => request(app.getHttpServer());
  const as = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);
  /** Wait for the background preparer to finish every pile it holds. */
  const backgroundDone = async () => {
    const { ReceiptScanPreparer } = await import("../../src/ai/receipt-scan.preparer");
    await app.get(ReceiptScanPreparer).idle();
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .overrideProvider("AiBatchClient")
      .useValue(fake)
      .overrideProvider("DriveApi")
      .useValue(drive)
      .overrideProvider("AiClock")
      .useValue({ now: () => clockNow })
      .overrideProvider("AiPollerTimer")
      .useValue({
        setTimer: (fn: () => void, ms: number) => timers.push({ fn, ms }),
        clearTimer: () => undefined,
      })
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
          tin: "000555111",
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

    drive.add({
      id: FOLDER,
      name: "Invented Receipts 2026",
      mimeType: "application/vnd.google-apps.folder",
      modifiedTime: "2026-09-01T00:00:00.000Z",
      parent: null,
    });
    drive.add({
      id: SUB,
      name: "August",
      mimeType: "application/vnd.google-apps.folder",
      modifiedTime: "2026-09-01T00:00:00.000Z",
      parent: FOLDER,
    });
    drive.add({
      id: HEIC,
      name: "IMG_0301.HEIC",
      mimeType: "image/heif",
      modifiedTime: "2026-09-03T00:00:00.000Z",
      parent: FOLDER,
      bytes: fixture("heic-irot90.heic"),
    });
    drive.add({
      id: JPEG,
      name: "hardware.jpg",
      mimeType: "image/jpeg",
      modifiedTime: "2026-09-02T00:00:00.000Z",
      parent: FOLDER,
      bytes: fixture("photo.dat"),
    });
    drive.add({
      id: PDF,
      name: "rent.pdf",
      mimeType: "application/pdf",
      modifiedTime: "2026-09-04T00:00:00.000Z",
      parent: SUB,
      bytes: await pdf(),
    });
    drive.add({
      id: DOCS,
      name: "Expense notes",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-09-05T00:00:00.000Z",
      parent: FOLDER,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("T1 · a linked Drive folder: listed, sent as a pile prepared in the background, nothing in the bucket, signed image links, already read", async () => {
    // Link the folder by the link a browser's share box gives.
    const linked = await as(http().put(`${API}/clients/${clientId}/drive-folder`)).send({
      link: `https://drive.google.com/drive/u/0/folders/${FOLDER}?usp=sharing`,
    });
    expect([linked.status, linked.body]).toEqual([
      200,
      {
        id: FOLDER,
        name: "Invented Receipts 2026",
        link: `https://drive.google.com/drive/folders/${FOLDER}`,
      },
    ]);
    const client = await as(http().get(`${API}/clients/${clientId}`));
    expect(client.body.driveFolder).toEqual(linked.body);

    // The listing: newest first, the subfolder's path, the Docs file's problem.
    const listing = await as(
      http().get(`${API}/receipt-scans/drive?clientId=${clientId}`),
    );
    expect(listing.status).toBe(200);
    expect(listing.body.folder).toEqual(linked.body);
    expect(listing.body.truncated).toBe(false);
    expect(
      listing.body.files.map((f: Record<string, unknown>) => [
        f.name,
        f.path,
        f.alreadyRead,
        f.problem,
      ]),
    ).toEqual([
      ["Expense notes", "", false, "A Google Docs file, not a photo or PDF."],
      ["rent.pdf", "August", false, null],
      ["IMG_0301.HEIC", "", false, null],
      ["hardware.jpg", "", false, null],
    ]);
    expect(listing.body.files[1]).toMatchObject({
      driveFileId: PDF,
      mimeType: "application/pdf",
      modifiedTime: "2026-09-04T00:00:00.000Z",
    });

    // Send the three that can be sent: 202, "preparing", nothing sent yet.
    const sent = await as(
      http().post(
        `${API}/receipt-scans/drive?clientId=${clientId}&periodFrom=2026-07-01&periodTo=2026-09-30`,
      ),
    ).send({ driveFileIds: [HEIC, JPEG, PDF] });
    expect(sent.status).toBe(202);
    expect(sent.body).toEqual({ id: expect.any(String), status: "preparing", files: 3 });
    const scanId = sent.body.id as string;

    // The background step: the pile is prepared and sent as one batch.
    await backgroundDone();
    const scan = await writer.receiptScan.findUniqueOrThrow({ where: { id: scanId } });
    expect([scan.status, scan.batchId]).toEqual(["reading", "msgbatch_drive_1"]);
    expect(fake.creates).toHaveLength(1);
    const files = await writer.receiptScanFile.findMany({
      where: { scanId },
      orderBy: { position: "asc" },
    });
    expect(
      files.map((f) => [f.name, f.source, f.driveFileId, f.storageKey, f.result]),
    ).toEqual([
      ["IMG_0301.HEIC", "drive", HEIC, null, "pending"],
      ["hardware.jpg", "drive", JPEG, null, "pending"],
      ["rent.pdf", "drive", PDF, null, "pending"],
    ]);
    // Prepared exactly as an upload: the HEIC upright as a JPEG with no EXIF.
    const byId = new Map(fake.creates[0]!.map((r) => [r.custom_id, r]));
    const content = (id: string) =>
      (
        byId.get(id)!.params.messages as Array<{
          content: Array<Record<string, unknown>>;
        }>
      )[0]!.content[0] as { type: string; source: { media_type: string; data: string } };
    const heic = content(files[0]!.id);
    expect([heic.type, heic.source.media_type]).toEqual(["image", "image/jpeg"]);
    const heicMeta = await sharp(Buffer.from(heic.source.data, "base64")).metadata();
    expect([heicMeta.width, heicMeta.height, heicMeta.exif]).toEqual([
      240,
      320,
      undefined,
    ]);
    expect(content(files[2]!.id).source.media_type).toBe("application/pdf");
    // Nothing reached the bucket; Drive saw only reads.
    expect([storage.puts, storage.objects.size]).toEqual([0, 0]);
    expect(
      drive.calls.every((c) => /^(status|getFile|listFolder|download)\b/.test(c)),
    ).toBe(true);

    // Each file: its Drive page and a signed link to its image.
    const detail = await as(http().get(`${API}/receipt-scans/${scanId}`));
    expect(detail.status).toBe(200);
    const shown = detail.body.files as Array<Record<string, string>>;
    expect(shown.map((f) => [f.source, f.driveLink])).toEqual([
      ["drive", `https://drive.google.com/file/d/${HEIC}/view`],
      ["drive", `https://drive.google.com/file/d/${JPEG}/view`],
      ["drive", `https://drive.google.com/file/d/${PDF}/view`],
    ]);
    const path = (url: string) => {
      expect(url.startsWith("https://api.invented.test/api/v1/")).toBe(true);
      return url.slice("https://api.invented.test".length);
    };
    // No Authorization header: the link alone opens it.
    const img = await http().get(path(shown[0]!.imageUrl!)).buffer(true);
    expect([img.status, img.headers["content-type"]]).toEqual([200, "image/jpeg"]);
    expect((await sharp(img.body as Buffer).metadata()).format).toBe("jpeg");
    const doc = await http().get(path(shown[2]!.imageUrl!)).buffer(true);
    expect([doc.status, doc.headers["content-type"]]).toEqual([200, "application/pdf"]);
    expect((doc.body as Buffer).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // A tampered link is refused; so is one past its hour.
    const tampered = path(shown[1]!.imageUrl!).replace(/signature=./, "signature=0");
    expect((await http().get(tampered)).status).toBe(403);
    clockNow = new Date(clockNow.getTime() + 2 * 3600_000);
    expect((await http().get(path(shown[1]!.imageUrl!))).status).toBe(403);
    clockNow = new Date("2026-10-11T02:00:00.000Z");
    // Gone from Drive (or no longer shared): 404.
    const fresh = (await as(http().get(`${API}/receipt-scans/${scanId}`))).body
      .files as Array<Record<string, string>>;
    drive.items.delete(JPEG);
    expect((await http().get(path(fresh[1]!.imageUrl!))).status).toBe(404);
    drive.add({
      id: JPEG,
      name: "hardware.jpg",
      mimeType: "image/jpeg",
      modifiedTime: "2026-09-02T00:00:00.000Z",
      parent: FOLDER,
      bytes: fixture("photo.dat"),
    });

    // A second listing marks the three as already read.
    const again = await as(http().get(`${API}/receipt-scans/drive?clientId=${clientId}`));
    expect(
      (again.body.files as Array<Record<string, unknown>>).map((f) => [
        f.name,
        f.alreadyRead,
      ]),
    ).toEqual([
      ["Expense notes", false],
      ["rent.pdf", true],
      ["IMG_0301.HEIC", true],
      ["hardware.jpg", true],
    ]);
  });

  // --- review follow-up -----------------------------------------------------------

  describe("review follow-up · one folder, one client; Google's refusals in words", () => {
    let otherClient = "";
    const link = (client: string, l: string) =>
      as(http().put(`${API}/clients/${client}/drive-folder`)).send({ link: l });
    beforeAll(async () => {
      otherClient = (
        await writer.client.create({
          data: { firmId, businessName: `${TAG} Another Invented Co`, tin: "000555222" },
        })
      ).id;
      drive.add({
        id: "1InventedParentOfAllxyz",
        name: "All clients",
        mimeType: "application/vnd.google-apps.folder",
        modifiedTime: "2026-09-01T00:00:00.000Z",
        parent: null,
      });
      // The linked folder now sits inside "All clients".
      drive.items.get(FOLDER)!.parent = "1InventedParentOfAllxyz";
    });
    afterAll(() => {
      drive.items.get(FOLDER)!.parent = null;
      drive.refuse = null;
    });

    it("another client cannot link the same folder, a folder inside it, or one holding it (409)", async () => {
      expect(
        (await as(http().get(`${API}/clients/${clientId}`))).body.driveFolder.id,
      ).toBe(FOLDER);
      const same = await link(otherClient, FOLDER);
      expect([same.status, same.body.message]).toEqual([
        409,
        "That folder is already linked to another client. A folder can belong to one client only.",
      ]);
      const inside = await link(otherClient, SUB);
      expect([inside.status, inside.body.message]).toEqual([
        409,
        "That folder is inside a folder already linked to another client. A folder can belong to one client only.",
      ]);
      const holding = await link(otherClient, "1InventedParentOfAllxyz");
      expect([holding.status, holding.body.message]).toEqual([
        409,
        "That folder holds a folder already linked to another client. A folder can belong to one client only.",
      ]);
      expect(
        (await writer.client.findUniqueOrThrow({ where: { id: otherClient } }))
          .driveFolderId,
      ).toBeNull();
      // The client's own folder may be linked again (to itself).
      expect((await link(clientId, FOLDER)).status).toBe(200);
    });

    it("Google refusing (API off, busy) answers 503 with its sentence, never a 500", async () => {
      drive.refuse = new DriveError(
        "api-disabled",
        "Turn on the Google Drive API for the robot's project (Google Cloud → APIs & Services → Library).",
      );
      const off = await as(http().get(`${API}/receipt-scans/drive?clientId=${clientId}`));
      expect([off.status, off.body.message]).toEqual([
        503,
        "Turn on the Google Drive API for the robot's project (Google Cloud → APIs & Services → Library).",
      ]);
      drive.refuse = new DriveError(
        "unreachable",
        "Google Drive is busy just now (too many requests). Try again in a few minutes.",
      );
      const busy = await as(
        http().post(
          `${API}/receipt-scans/drive?clientId=${clientId}&periodFrom=2026-07-01&periodTo=2026-09-30`,
        ),
      ).send({ driveFileIds: [JPEG] });
      expect([busy.status, busy.body.message]).toEqual([
        503,
        "Google Drive is busy just now (too many requests). Try again in a few minutes.",
      ]);
      drive.refuse = null;
    });
  });

  // --- T4 -------------------------------------------------------------------------

  describe("T4 · every pile is prepared in the background", () => {
    const scansOf = async () => {
      const { ReceiptScanService } = await import("../../src/ai/receipt-scan.service");
      return app.get(ReceiptScanService);
    };
    const upload = (files: Array<{ name: string; body: Buffer }>) => {
      let r = as(
        http().post(
          `${API}/receipt-scans?clientId=${clientId}&periodFrom=2026-07-01&periodTo=2026-09-30`,
        ),
      );
      for (const f of files)
        r = r.attach("files", f.body, { filename: f.name, contentType: "image/heic" });
      return r;
    };

    it("an upload pile of 20 HEICs answers 202 at once and finishes in the background", async () => {
      const files = Array.from({ length: 20 }, (_, i) => ({
        name: `IMG_${4000 + i}.HEIC`,
        // Distinct bytes per file: a trailing ISO-BMFF "free" box.
        body: Buffer.concat([
          fixture("heic-plain.heic"),
          Buffer.from([0, 0, 0, 12]),
          Buffer.from("free"),
          Buffer.from(String(1000 + i)),
        ]),
      }));
      const creates = fake.creates.length;
      const res = await upload(files);
      expect([res.status, res.body.status, res.body.files]).toEqual([
        202,
        "preparing",
        20,
      ]);
      await backgroundDone();
      const scan = await writer.receiptScan.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(scan.status).toBe("reading");
      expect(fake.creates.length).toBe(creates + 1);
      expect(fake.creates.at(-1)).toHaveLength(20);
      expect(existsSync(pileDir(res.body.id))).toBe(false);
    });

    it("a pile a restart left preparing ends failed after 30 minutes: reservation released, no temporary file left", async () => {
      const scans = await scansOf();
      const id = randomUUID();
      await writer.receiptScan.create({
        data: {
          id,
          firmId,
          clientId,
          periodFrom: new Date("2026-07-01T00:00:00.000Z"),
          periodTo: new Date("2026-09-30T00:00:00.000Z"),
          status: "preparing",
          model: "claude-sonnet-5-5",
          promptVersion: "receipts-v1",
          month: "2026-10",
          estimatedUsd: 3.25,
          createdAt: clockNow,
          inputJson: { files: [{ name: "x.jpg", source: "upload", bytes: 3, tmp: "0" }] },
        },
      });
      mkdirSync(pileDir(id), { recursive: true });
      writeFileSync(join(pileDir(id), "0"), "abc");
      // A folder left by a pile that was sent before the API stopped: no pile is
      // preparing it, so the same sweep removes it.
      const orphan = randomUUID();
      mkdirSync(pileDir(orphan), { recursive: true });
      writeFileSync(join(pileDir(orphan), "0"), "left behind");
      const old = (Date.now() - 11 * 60_000) / 1000; // older than a pile mid-accept
      utimesSync(pileDir(orphan), old, old);
      // A folder of a pile still being accepted (no row yet, made just now) stays.
      const young = randomUUID();
      mkdirSync(pileDir(young), { recursive: true });
      const reserved = async () =>
        (await as(http().get(`${API}/ai/status`))).body.reservedUsd as number;
      const before = await reserved();
      // Not yet 30 minutes: it stays.
      clockNow = new Date(clockNow.getTime() + 29 * 60_000);
      expect(await scans.endStalePreparing(new Set())).toBe(0);
      // Past 30 minutes, the poller's tick ends it.
      clockNow = new Date(clockNow.getTime() + 2 * 60_000);
      const due = timers.splice(0);
      if (due.length === 0) {
        expect(await scans.endStalePreparing(new Set())).toBe(1);
      } else {
        for (const t of due) t.fn();
        for (let i = 0; i < 100; i++) {
          const s = await writer.receiptScan.findUniqueOrThrow({ where: { id } });
          if (s.status !== "preparing") break;
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      clockNow = new Date("2026-10-11T02:00:00.000Z");
      const s = await writer.receiptScan.findUniqueOrThrow({ where: { id } });
      expect(existsSync(pileDir(orphan))).toBe(false);
      expect(existsSync(pileDir(young))).toBe(true);
      rmSync(pileDir(young), { recursive: true, force: true });
      expect([s.status, s.problem, Number(s.actualUsd)]).toEqual([
        "failed",
        "The Portal restarted while preparing these files. Nothing was sent or charged; send them again.",
        0,
      ]);
      expect(Math.round((before - (await reserved())) * 100) / 100).toBe(3.25);
      expect(existsSync(pileDir(id))).toBe(false);
    });

    it("a pile this process is still preparing is never ended by the sweep", async () => {
      const scans = await scansOf();
      const id = randomUUID();
      await writer.receiptScan.create({
        data: {
          id,
          firmId,
          clientId,
          periodFrom: new Date("2026-07-01T00:00:00.000Z"),
          periodTo: new Date("2026-09-30T00:00:00.000Z"),
          status: "preparing",
          model: "claude-sonnet-5-5",
          promptVersion: "receipts-v1",
          month: "2026-10",
          estimatedUsd: 0.1,
          createdAt: new Date(clockNow.getTime() - 60 * 60_000),
          inputJson: { files: [] },
        },
      });
      expect(await scans.endStalePreparing(new Set([id]))).toBe(0);
      await writer.receiptScan.update({ where: { id }, data: { status: "failed" } });
    });

    it("over budget once prepared ends the pile failed with the 409 sentence; nothing is sent or stored", async () => {
      const scans = await scansOf();
      const id = randomUUID();
      await writer.receiptScan.create({
        data: {
          id,
          firmId,
          clientId,
          periodFrom: new Date("2026-07-01T00:00:00.000Z"),
          periodTo: new Date("2026-09-30T00:00:00.000Z"),
          status: "preparing",
          model: "claude-sonnet-5-5",
          promptVersion: "receipts-v1",
          month: "2026-10",
          estimatedUsd: 0.05,
          createdAt: clockNow,
          inputJson: {
            files: [{ name: "late.jpg", source: "upload", bytes: 2044, tmp: "0" }],
          },
        },
      });
      mkdirSync(pileDir(id), { recursive: true });
      writeFileSync(
        join(pileDir(id), "0"),
        Buffer.concat([fixture("photo.dat"), Buffer.from("late")]),
      );
      // Between the POST and the background step, the month's budget was spent.
      const spent = await writer.receiptScan.create({
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
          estimatedUsd: 25,
          actualUsd: 25,
        },
      });
      const creates = fake.creates.length;
      const puts = storage.puts;
      await scans.prepare(id);
      const s = await writer.receiptScan.findUniqueOrThrow({ where: { id } });
      expect(s.status).toBe("failed");
      expect(s.problem).toMatch(
        /^This pile would cost about US\$\d+\.\d\d \(₱[\d,]+\.\d\d\), but only US\$0\.00 \(₱0\.00\) is left of this month's US\$25\.00 AI budget\. Nothing was sent\.$/,
      );
      expect([fake.creates.length, storage.puts]).toEqual([creates, puts]);
      expect(await writer.receiptScanFile.count({ where: { scanId: id } })).toBe(0);
      expect(existsSync(pileDir(id))).toBe(false);
      await writer.receiptScan.delete({ where: { id: spent.id } });
    });
  });
});

// --- T3 ---------------------------------------------------------------------------

describe("U14 T3 · the robot's key (the real Google client, a fake fetch for Google)", () => {
  const ROBOT_EMAIL = "portal-robot@invented-project.iam.gserviceaccount.com";
  // This firm's own folder (a folder belongs to one client, across firms).
  const KEY_FOLDER = "1InventedKeyFirmFolderXyz";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pemBody = pem.split("\n").slice(1, -2).join("");
  const keyJson = {
    type: "service_account",
    project_id: "invented-project",
    private_key_id: "0123456789abcdef",
    private_key: pem,
    client_email: ROBOT_EMAIL,
    client_id: "100000000000000000000",
    token_uri: "https://oauth2.googleapis.com/token",
  };
  const pretty = JSON.stringify(keyJson, null, 2);

  let app3: INestApplication;
  let writer3: PrismaService;
  let token3 = "";
  let clientId3 = "";
  let apiDisabled = false;
  let refuseKey = false;
  const requests: Array<{ method: string; url: string }> = [];
  const captured: string[] = [];
  const restore: Array<() => void> = [];

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  /** Google, faked: the token endpoint checks the robot's signed assertion with
   *  the public key; the Drive API answers a folder and its empty listing. */
  const fakeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push({ method: init?.method ?? "GET", url });
    if (url === "https://oauth2.googleapis.com/token") {
      if (refuseKey) return json(400, { error: "invalid_grant" });
      const assertion = new URLSearchParams(String(init?.body)).get("assertion") ?? "";
      const [h, c, sig] = assertion.split(".");
      const claims = JSON.parse(Buffer.from(c!, "base64url").toString());
      const ok =
        JSON.parse(Buffer.from(h!, "base64url").toString()).alg === "RS256" &&
        claims.iss === ROBOT_EMAIL &&
        claims.scope === "https://www.googleapis.com/auth/drive.readonly" &&
        claims.aud === "https://oauth2.googleapis.com/token" &&
        createVerify("RSA-SHA256")
          .update(`${h}.${c}`)
          .verify(publicKey, Buffer.from(sig!, "base64url"));
      return ok
        ? json(200, { access_token: "ya29.invented-token", expires_in: 3600 })
        : json(400, { error: "invalid_grant" });
    }
    if (apiDisabled)
      return json(403, {
        error: {
          code: 403,
          status: "PERMISSION_DENIED",
          errors: [{ reason: "accessNotConfigured" }],
        },
      });
    if (url.includes("/about")) return json(200, { user: { emailAddress: ROBOT_EMAIL } });
    if (url.includes(`/files/${KEY_FOLDER}?`))
      return json(200, {
        id: KEY_FOLDER,
        name: "Invented Receipts 2026",
        mimeType: "application/vnd.google-apps.folder",
        modifiedTime: "2026-09-01T00:00:00.000Z",
      });
    if (url.includes("/files?q=")) return json(200, { files: [] });
    return json(404, { error: { code: 404, errors: [{ reason: "notFound" }] } });
  };

  const http3 = () => request(app3.getHttpServer());
  const status = async () =>
    (await http3().get(`${API}/drive/status`).set("Authorization", `Bearer ${token3}`))
      .body;

  beforeAll(async () => {
    // Every line the app writes: Nest's logger goes to stdout/stderr, not console.
    for (const stream of [process.stdout, process.stderr]) {
      const write = stream.write.bind(stream);
      const spy = jest
        .spyOn(stream, "write")
        .mockImplementation((chunk: string | Uint8Array, ...rest: unknown[]) => {
          captured.push(String(chunk));
          return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
        });
      restore.push(() => spy.mockRestore());
    }
    for (const m of ["log", "warn", "error", "info", "debug"] as const) {
      const spy = jest.spyOn(console, m).mockImplementation((...a: unknown[]) => {
        captured.push(a.map(String).join(" "));
      });
      restore.push(() => spy.mockRestore());
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider("DriveFetch")
      .useValue(fakeFetch)
      .compile();
    app3 = moduleRef.createNestApplication();
    app3.useLogger(["log", "warn", "error"]);
    app3.setGlobalPrefix("api/v1");
    await app3.init();
    writer3 = app3.get(PrismaService);
    const firm = await writer3.firm.create({ data: { name: `${TAG} Key Firm` } });
    clientId3 = (
      await writer3.client.create({
        data: { firmId: firm.id, businessName: `${TAG} Key Client`, tin: "000222333" },
      })
    ).id;
    const u = await writer3.user.create({
      data: {
        firmId: firm.id,
        userType: "FIRM",
        fullName: `${TAG} key tester`,
        email: `${TAG}-key@example.com`,
        status: "ACTIVE",
        firmProfile: { create: { title: "Test" } },
        userRoles: {
          create: {
            roleId: (
              await writer3.role.findUniqueOrThrow({
                where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
              })
            ).id,
          },
        },
      },
    });
    token3 = app3
      .get(TokenService)
      .signAccess({ id: u.id, firmId: firm.id, userType: "FIRM", email: u.email });
  });

  afterAll(async () => {
    await app3.close();
    for (const r of restore.reverse()) r();
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  });

  it("absent, broken, refused and API-not-enabled each give their status", async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    expect(await status()).toEqual({
      configured: false,
      robotEmail: null,
      problem: null,
    });
    const link = await http3()
      .put(`${API}/clients/${clientId3}/drive-folder`)
      .set("Authorization", `Bearer ${token3}`)
      .send({ link: FOLDER });
    expect([link.status, link.body.message]).toEqual([
      503,
      "Google Drive isn't set up yet.",
    ]);

    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "{ this is not a key";
    expect(await status()).toEqual({
      configured: false,
      robotEmail: null,
      problem: "The key in GOOGLE_SERVICE_ACCOUNT_JSON could not be read.",
    });
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      ...keyJson,
      private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n",
    });
    expect((await status()).problem).toBe(
      "The key in GOOGLE_SERVICE_ACCOUNT_JSON could not be read.",
    );

    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = pretty;
    refuseKey = true;
    expect(await status()).toEqual({
      configured: false,
      robotEmail: ROBOT_EMAIL,
      problem:
        "Google refused the robot's key. Make a new key for the robot in Google Cloud and put it in GOOGLE_SERVICE_ACCOUNT_JSON.",
    });
    refuseKey = false;

    // A changed key is checked afresh (the 5-minute memory is per key).
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = ` ${pretty} `;
    apiDisabled = true;
    expect(await status()).toEqual({
      configured: false,
      robotEmail: ROBOT_EMAIL,
      problem:
        "Turn on the Google Drive API for the robot's project (Google Cloud → APIs & Services → Library).",
    });
    apiDisabled = false;
  });

  it("the key works pasted as is, with its line breaks stripped, in quotes, and as base64", async () => {
    const variants = {
      pretty,
      lineBreaksStripped: pretty.replace(/\n/g, ""),
      pemWithoutBreaks: JSON.stringify({
        ...keyJson,
        private_key: `-----BEGIN PRIVATE KEY-----${pemBody}-----END PRIVATE KEY-----`,
      }),
      quoted: `'${JSON.stringify(keyJson)}'`,
      base64: Buffer.from(pretty).toString("base64"),
    };
    for (const [name, value] of Object.entries(variants)) {
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON = value;
      expect([name, await status()]).toEqual([
        name,
        { configured: true, robotEmail: ROBOT_EMAIL, problem: null },
      ]);
    }
    const linked = await http3()
      .put(`${API}/clients/${clientId3}/drive-folder`)
      .set("Authorization", `Bearer ${token3}`)
      .send({ link: `https://drive.google.com/open?id=${KEY_FOLDER}` });
    expect([linked.status, linked.body.id]).toEqual([200, KEY_FOLDER]);
    // Only reads ever went to Drive.
    const drive = requests.filter((r) => r.url.startsWith("https://www.googleapis.com/"));
    expect(drive.length).toBeGreaterThan(0);
    expect(drive.every((r) => r.method === "GET")).toBe(true);
  });

  it("the private key's text appears in no response body, log line or audit row", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = pretty;
    const bodies = [
      JSON.stringify(await status()),
      JSON.stringify(
        (
          await http3()
            .get(`${API}/clients/${clientId3}`)
            .set("Authorization", `Bearer ${token3}`)
        ).body,
      ),
      JSON.stringify(
        (
          await http3()
            .get(`${API}/receipt-scans/drive?clientId=${clientId3}`)
            .set("Authorization", `Bearer ${token3}`)
        ).body,
      ),
    ];
    const audits = JSON.stringify(await writer3.auditLog.findMany({}));
    expect(audits).toContain("client.drive-folder.link");
    const everything = [...bodies, audits, ...captured].join("\n");
    expect(everything).toContain(ROBOT_EMAIL); // the email may be shown
    for (const secret of [pemBody.slice(0, 40), pemBody.slice(-40), "0123456789abcdef"])
      expect(everything).not.toContain(secret);
    // The app's own log lines were captured: the broken and refused keys above
    // were logged, by their sentence only.
    expect(captured.some((l) => l.includes("Google Drive is not usable"))).toBe(true);
  });
});
