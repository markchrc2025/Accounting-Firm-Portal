/**
 * receipt-scan.service.ts — the AI receipt reader, part 1 (U11, D49). A pile of
 * receipt photos for one client and one period goes to Claude overnight through
 * Anthropic's Message Batches API, and comes back as rows in the expenses-v2
 * template's 27 columns, each checked by the workbook import's own rules. Nothing
 * here writes to the books: review and approval are U12.
 *
 * Logs carry counts, ids and costs only — never image bytes, never the AI's
 * answer, never the key (R11).
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import {
  ReceiptScanStatus,
  ScanFileResult,
  type AiModel,
  type ReceiptScanDetail,
  type ReceiptScanSummary,
  type ScanCells,
  type ScanCheck,
  type ScanDoubt,
  type ScanFile,
  type ScanRow,
} from "@portal/shared";
import { AuditService } from "../audit/audit.service";
import { DRIVE_API, type DriveApi } from "../drive/drive-api";
import { fileLink } from "../drive/drive-links";
import {
  DriveService,
  MAX_DRIVE_FILE_BYTES,
  TOO_LARGE,
  listingProblem,
} from "../drive/drive.service";
import type { AuthUser } from "../common/auth/auth-user";
import { RegimeValidator } from "../financial/regime-validator";
import { isoToDate } from "../financial/serialization";
import { PrismaService } from "../prisma/prisma.service";
import { ExpenseImportService } from "../purchase-transactions/import/expense-import.service";
import { isRealIsoDate } from "../purchase-transactions/import/expense-import.rules";
import { RbacService } from "../rbac/rbac.service";
import { StorageService } from "../storage/storage.service";
import {
  AiSettingsService,
  RESERVING,
  aiKeyConfigured,
  manilaMonth,
  money,
} from "./ai-settings.service";
import { AI_BATCH_CLIENT } from "./ai.tokens";
import { ANSWER_JSON_SCHEMA, parseAnswer } from "./answer";
import type { AiBatchClient, BatchRequest, BatchResultLine } from "./batch-client";
import {
  MAX_IMAGE_TOKENS,
  MAX_OUTPUT_TOKENS,
  MAX_PDF_PAGES,
  fileEstimateUsd,
  instructionTokens,
  pdfTokens,
  textTokens,
} from "./estimate";
import { RECEIPTS_PROMPT_VERSION, buildInstructions } from "./instructions";
import { mapReceipt } from "./mapping";
import { imageLink, imageLinkSecret } from "./image-link";
import {
  notPhotoOrPdf,
  pdfPages,
  prepareUpload,
  sha256,
  sniff,
  type Prepared,
} from "./prepare";
import { SCAN_UPLOAD_DIR } from "./scan-upload.interceptor";
import { costOfUsage, round6 } from "./prices";

// --- every sentence a user reads (R3, R5, R6, R9) --------------------------------
export const AI_NOT_SET_UP =
  "AI reading isn't set up yet. The Super Admin adds the key to the API service.";
export const AI_SWITCHED_OFF = "AI reading is switched off in Settings.";
export const STORAGE_OFF =
  "File storage isn't set up, so receipt photos can't be kept. The Super Admin sets up storage for the API service.";
export const BATCH_REFUSED =
  "The AI service could not take the pile just now. Nothing was charged; try again later.";
export const STORE_FAILED =
  "The receipt files could not be stored just now. Nothing was sent; try again later.";
export const BATCH_EXPIRED =
  "The AI service did not finish within 24 hours; unfinished files were not charged.";
export const COLLECT_GAVE_UP =
  "The AI's results for this pile could not be collected within 3 days, so its estimate is counted as spent. Send the receipts again.";
export const NOT_SENT =
  "The pile was not sent to the AI service; nothing was charged. Send it again.";
export const FILE_EXPIRED =
  "The AI service did not finish this file within 24 hours; it was not charged.";
export const FILE_ERRORED =
  "The AI service could not read this file; it was not charged.";
export const FILE_MALFORMED =
  "The AI's answer for this file could not be read, so no rows were made from it.";
export const NO_FILES = "Choose at least one receipt photo or PDF.";
export const BAD_PILE_QUERY =
  "Choose a client and a period: clientId, and periodFrom and periodTo as dates (YYYY-MM-DD), with periodFrom on or before periodTo.";
// U14 (R2, R3)
export const PREPARING_RESTARTED =
  "The Portal restarted while preparing these files. Nothing was sent or charged; send them again.";
export const PREPARE_FAILED =
  "These files could not be prepared. Nothing was sent or charged; send them again.";
export const DRIVE_FILE_GONE =
  "This file is no longer in the client's Google Drive folder, or no longer shared with the Portal's robot.";
export const NO_DRIVE_FOLDER = "This client has no Google Drive folder linked yet.";
export const NOT_IN_FOLDER =
  "Some of these files are not in this client's Google Drive folder. Refresh the list and choose again.";
export const DRIVE_PILE_IDS =
  "Choose 1 to 100 different files from the client's Google Drive folder, sent as driveFileIds.";
const COPY_IN_PILE = (name: string) =>
  `An exact copy of ${name} in this pile; it was not sent again.`;
const COPY_EARLIER = (name: string, on: string) =>
  `An exact copy of ${name}, sent on ${on}; it was not sent again.`;

const MAX_FILES = 100;
/** A collecting instance holds its lease this long before another may take over. */
const LEASE_MS = 15 * 60 * 1000;
/** A pile whose results cannot be collected for this long ends as failed. */
const GIVE_UP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
/** A pile left "preparing" this long by a restart is ended (U14 R3). */
const PREPARING_FOR_MS = 30 * 60 * 1000;
/** A pile still without a batch after this long was never sent. */
const UNSENT_AFTER_MS = 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the multipart interceptor hands over for each file: written to a
 *  temporary file on disk, which the interceptor removes when the request ends. */
export interface UploadedScanFile {
  path: string;
  originalname: string;
  size: number;
}

class AlreadyCollected extends Error {}

/** One file of a pile waiting to be prepared (receipt_scans.inputJson, U14). */
export interface PileInputFile {
  name: string;
  source: "upload" | "drive";
  bytes: number;
  /** Its temporary file's name in the pile's folder. */
  tmp: string;
  driveFileId?: string;
  mimeType?: string;
  /** Why it cannot be sent, known before it is fetched (a Drive listing's). */
  problem?: string | null;
}
interface PileInput {
  files: PileInputFile[];
}
interface PreparedItem {
  file: PileInputFile;
  id: string;
  sha: string;
  prepared?: Extract<Prepared, { ok: true }>;
  problem?: string;
}

/** POST /receipt-scans and POST /receipt-scans/drive answer 202 with this. */
export interface PileAccepted {
  id: string;
  status: "preparing";
  files: number;
}

/** A pile's own private temporary folder while it is prepared. */
export const pileDir = (scanId: string) => join(SCAN_UPLOAD_DIR, "piles", scanId);

/** A file's first 64 KB: enough for its type (prepare.ts sniff). */
async function readHead(path: string): Promise<Buffer> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/** The 409 over budget (R5), used before answering and again after preparing. */
function overBudget(
  total: number,
  used: number,
  settings: { budget: number; usdToPhp: number },
): string {
  const left = Math.max(0, settings.budget - used);
  return (
    `This pile would cost about ${money(total, settings.usdToPhp, "up")}, but only ` +
    `${money(left, settings.usdToPhp, "down")} is left of this month's ` +
    `US$${settings.budget.toFixed(2)} AI budget. Nothing was sent.`
  );
}

/** A Message Batch holds at most 256 MB (batch docs); a pile sends at most 200 MB
 *  of base64 file data, leaving room for the instructions and the JSON. */
export const MAX_PILE_PAYLOAD_BYTES = 200_000_000;

/** The refusal for a pile whose files, base64-encoded as they are sent, would not
 *  fit one Message Batch; null when they fit. */
export function pileTooLarge(byteLengths: number[]): string | null {
  const payload = byteLengths.reduce((a, n) => a + Math.ceil(n / 3) * 4, 0);
  if (payload <= MAX_PILE_PAYLOAD_BYTES) return null;
  return (
    `This pile is too large to send at once: about ${Math.ceil(payload / 1_000_000)} MB once ` +
    `prepared, and a pile can send at most ${MAX_PILE_PAYLOAD_BYTES / 1_000_000} MB. Split it into smaller piles.`
  );
}

/** multer hands over the file name as latin1; a browser sends UTF-8. */
export function uploadName(raw: string): string {
  const utf8 = Buffer.from(raw, "latin1").toString("utf8");
  return utf8.includes("\uFFFD") ? raw : utf8;
}

/** The request's own text: the client's name and TIN, the period, the file name. */
export function requestText(ctx: {
  buyer: string;
  tin: string | null;
  periodFrom: string;
  periodTo: string;
  fileName: string;
}): string {
  return (
    `The client (the buyer, never the vendor): ${ctx.buyer}, TIN ${ctx.tin ?? "not on file"}.\n` +
    `Period: ${ctx.periodFrom} to ${ctx.periodTo}.\n` +
    `File name: ${ctx.fileName}`
  );
}

@Injectable()
export class ReceiptScanService {
  private readonly logger = new Logger("ReceiptScans");

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AiSettingsService,
    private readonly storage: StorageService,
    private readonly rbac: RbacService,
    private readonly regime: RegimeValidator,
    private readonly expenseImport: ExpenseImportService,
    private readonly audit: AuditService,
    @Inject(AI_BATCH_CLIENT) private readonly ai: AiBatchClient,
    private readonly drive: DriveService,
    @Inject(DRIVE_API) private readonly driveApi: DriveApi,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------ availability

  /** 503 unless the key is set, AI is switched on, and storage is set up (R3). A
   *  Drive pile (U14) keeps nothing in the bucket, so it needs no storage. */
  private async requireAvailable(firmId: string, needsStorage = true) {
    const s = await this.settings.settings(firmId);
    if (!aiKeyConfigured()) throw new ServiceUnavailableException(AI_NOT_SET_UP);
    if (!s.enabled) throw new ServiceUnavailableException(AI_SWITCHED_OFF);
    if (needsStorage && !this.storage.isEnabled())
      throw new ServiceUnavailableException(STORAGE_OFF);
    return s;
  }

  // ------------------------------------------------------------ estimate (route 2)

  async estimateRoute(user: AuthUser, images: number, pdfs: number) {
    const s = await this.requireAvailable(user.firmId);
    const instr = instructionTokens(await this.instructions());
    const estimated = round6(
      images * fileEstimateUsd(s.model, MAX_IMAGE_TOKENS, instr) +
        pdfs * fileEstimateUsd(s.model, pdfTokens(MAX_PDF_PAGES), instr),
    );
    const status = await this.settings.status(user.firmId);
    return {
      estimatedUsd: estimated,
      remainingUsd: status.remainingUsd,
      fits: estimated <= status.remainingUsd,
    };
  }

  // ------------------------------------------------------------ create (route 3)

  /**
   * The checks every pile's POST makes before anything else (R10, D42): the query,
   * Expenses:Create on this assigned client, and AI (and, for uploads, storage)
   * set up.
   */
  private async pileCheck(
    user: AuthUser,
    query: { clientId?: string; periodFrom?: string; periodTo?: string },
    needsStorage: boolean,
  ) {
    const { clientId, periodFrom, periodTo } = query;
    if (
      !clientId ||
      !UUID.test(clientId) ||
      !periodFrom ||
      !periodTo ||
      !isRealIsoDate(periodFrom) ||
      !isRealIsoDate(periodTo) ||
      periodFrom > periodTo
    ) {
      throw new BadRequestException(BAD_PILE_QUERY);
    }
    await this.rbac.assertClient(user, ["Expenses:Create"], clientId);
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, firmId: user.firmId },
      select: { id: true, driveFolderId: true },
    });
    if (!client) throw new NotFoundException("Client not found");
    const settings = await this.requireAvailable(user.firmId, needsStorage);
    return { client, clientId, periodFrom, periodTo, settings };
  }

  /**
   * POST /receipt-scans (U14 R3): the uploads are on disk; what comes back at once
   * is the file count, each file's type by its bytes and a PDF's pages, and the
   * budget. The files move to the pile's own private folder and the pile answers
   * "preparing"; the preparer does the rest in the background.
   */
  async createUpload(
    user: AuthUser,
    query: { clientId?: string; periodFrom?: string; periodTo?: string },
    uploads: UploadedScanFile[],
  ): Promise<PileAccepted> {
    const checked = await this.pileCheck(user, query, true);
    if (uploads.length === 0) throw new BadRequestException(NO_FILES);
    if (uploads.length > MAX_FILES)
      throw new BadRequestException(`A pile holds at most ${MAX_FILES} files.`);
    let images = 0;
    let pdfs = 0;
    const names = uploads.map((u) => uploadName(u.originalname));
    for (const [i, u] of uploads.entries()) {
      const head = await readHead(u.path);
      const type = sniff(head);
      if (!type) throw new BadRequestException(notPhotoOrPdf(names[i]!, head));
      if (type === "pdf") {
        const pages = await pdfPages(names[i]!, await readFile(u.path));
        if ("message" in pages) throw new BadRequestException(pages.message);
        pdfs++;
      } else images++;
    }
    const scanId = randomUUID();
    const dir = pileDir(scanId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      const files: PileInputFile[] = [];
      for (const [i, u] of uploads.entries()) {
        await rename(u.path, join(dir, String(i)));
        files.push({ name: names[i]!, source: "upload", bytes: u.size, tmp: String(i) });
      }
      await this.accept(user, scanId, checked, files, images, pdfs);
      return { id: scanId, status: "preparing", files: files.length };
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err;
    }
  }

  /**
   * POST /receipt-scans/drive (U14 R2): files chosen from the client's linked Drive
   * folder. Each must be in that folder (its listing), so a pile can never read a
   * file the client did not share. A file that is no photo or PDF does not stop
   * the pile: it ends "unreadable" with its sentence.
   */
  async createDrive(
    user: AuthUser,
    query: { clientId?: string; periodFrom?: string; periodTo?: string },
    body: unknown,
  ): Promise<PileAccepted> {
    const ids = (body as { driveFileIds?: unknown } | undefined)?.driveFileIds;
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > MAX_FILES ||
      !ids.every((id) => typeof id === "string" && id.length > 0) ||
      new Set(ids).size !== ids.length
    ) {
      throw new BadRequestException(DRIVE_PILE_IDS);
    }
    const checked = await this.pileCheck(user, query, false);
    await this.drive.requireDrive();
    if (!checked.client.driveFolderId) throw new ConflictException(NO_DRIVE_FOLDER);
    const { files: listed } = await this.drive.listFolderTree(
      checked.client.driveFolderId,
    );
    const byId = new Map(listed.map((f) => [f.id, f]));
    if (!(ids as string[]).every((id) => byId.has(id)))
      throw new BadRequestException(NOT_IN_FOLDER);
    let images = 0;
    let pdfs = 0;
    const files: PileInputFile[] = (ids as string[]).map((id, i) => {
      const f = byId.get(id)!;
      const problem = listingProblem(f);
      if (!problem) {
        if (f.mimeType === "application/pdf") pdfs++;
        else images++;
      }
      return {
        name: f.name,
        source: "drive",
        bytes: f.size ?? 0,
        tmp: String(i),
        driveFileId: id,
        mimeType: f.mimeType,
        problem,
      };
    });
    const scanId = randomUUID();
    const dir = pileDir(scanId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    try {
      await this.accept(user, scanId, checked, files, images, pdfs);
      return { id: scanId, status: "preparing", files: files.length };
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err;
    }
  }

  /**
   * R3: the budget, checked before answering with the estimate GET /ai/estimate
   * gives for these counts (an upper bound), which the pile holds as its
   * reservation while it is prepared. 409 over budget; nothing kept.
   */
  private async accept(
    user: AuthUser,
    scanId: string,
    checked: Awaited<ReturnType<ReceiptScanService["pileCheck"]>>,
    files: PileInputFile[],
    images: number,
    pdfs: number,
  ): Promise<void> {
    const { settings, clientId, periodFrom, periodTo } = checked;
    const instr = instructionTokens(await this.instructions());
    const bound = round6(
      images * fileEstimateUsd(settings.model, MAX_IMAGE_TOKENS, instr) +
        pdfs * fileEstimateUsd(settings.model, pdfTokens(MAX_PDF_PAGES), instr),
    );
    const now = this.settings.now();
    const month = manilaMonth(now);
    await this.prisma.$transaction(async (tx) => {
      await this.lockBudget(tx, user.firmId);
      const used = await this.budgetUsed(tx, user.firmId, month);
      if (used + bound > settings.budget + 1e-9)
        throw new ConflictException(overBudget(bound, used, settings));
      await tx.receiptScan.create({
        data: {
          id: scanId,
          firmId: user.firmId,
          clientId,
          periodFrom: isoToDate(periodFrom),
          periodTo: isoToDate(periodTo),
          status: "preparing",
          model: settings.model,
          promptVersion: RECEIPTS_PROMPT_VERSION,
          month,
          estimatedUsd: bound,
          createdById: user.id,
          createdAt: now,
          inputJson: { files } as unknown as Prisma.InputJsonValue,
        },
      });
    });
    await this.audit.record({
      userId: user.id,
      action: "ai.receipt-scan.create",
      entityType: "ReceiptScan",
      entityId: scanId,
      metadata: {
        clientId,
        source: files[0]?.source ?? "upload",
        fileCount: files.length,
        reservedUsd: bound,
      },
    });
    this.logger.log(
      `pile ${scanId}: ${files.length} file(s) accepted, preparing; reserved US$${bound.toFixed(6)}`,
    );
  }

  private async lockBudget(tx: Prisma.TransactionClient, firmId: string): Promise<void> {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${firmId}`}))) AS l`;
  }

  /** This month's spent plus reserved, leaving out one pile's own reservation. */
  private async budgetUsed(
    tx: Prisma.TransactionClient,
    firmId: string,
    month: string,
    except?: string,
  ): Promise<number> {
    const [spentAgg, reservedAgg] = await Promise.all([
      tx.receiptScan.aggregate({
        where: { firmId, month },
        _sum: { actualUsd: true },
      }),
      tx.receiptScan.aggregate({
        where: {
          firmId,
          month,
          status: { in: [...RESERVING] },
          ...(except ? { id: { not: except } } : {}),
        },
        _sum: { estimatedUsd: true },
      }),
    ]);
    return (
      Number(spentAgg._sum.actualUsd ?? 0) + Number(reservedAgg._sum.estimatedUsd ?? 0)
    );
  }

  /**
   * The background step (R3), run by ReceiptScanPreparer one pile at a time: each
   * file fetched (an upload from the pile's folder, a Drive file downloaded into it)
   * and prepared exactly as U11 prepares an upload, one at a time; then copies, the
   * exact estimate and the budget again under the lock; then uploads are stored
   * (never a Drive file) and one Message Batch is sent. The pile's temporary folder
   * is removed whatever happens. A pile that cannot go on ends "failed" with its
   * reason, nothing sent and nothing charged.
   */
  async prepare(scanId: string): Promise<void> {
    const scan = await this.prisma.receiptScan.findUnique({
      where: { id: scanId },
      include: { client: { select: { businessName: true, regName: true, tin: true } } },
    });
    if (!scan || scan.status !== "preparing") return;
    const dir = pileDir(scanId);
    const fail = (problem: string) =>
      this.prisma.receiptScan.updateMany({
        where: { id: scanId, status: "preparing" },
        data: { status: "failed", problem, inputJson: Prisma.DbNull },
      });
    try {
      const input = (scan.inputJson ?? { files: [] }) as unknown as PileInput;
      const settings = await this.settings.settings(scan.firmId);
      const periodFrom = scan.periodFrom.toISOString().slice(0, 10);
      const periodTo = scan.periodTo.toISOString().slice(0, 10);
      const textFor = (fileName: string) =>
        requestText({
          buyer: scan.client.regName?.trim() || scan.client.businessName,
          tin: scan.client.tin,
          periodFrom,
          periodTo,
          fileName,
        });

      // 1. Fetch and prepare each file, one at a time.
      const items: PreparedItem[] = [];
      for (const f of input.files) {
        const path = join(dir, f.tmp);
        let problem = f.problem ?? null;
        if (!problem && f.source === "drive") {
          const got = await this.driveApi.download(
            f.driveFileId!,
            path,
            MAX_DRIVE_FILE_BYTES,
          );
          if (got === "gone") problem = DRIVE_FILE_GONE;
          else if (got === "too-large") problem = TOO_LARGE;
        }
        let bytes: Buffer | null = null;
        if (!problem) {
          // One file in memory at a time; the file itself stays in the pile's folder
          // until the pile is done, then the folder goes (finally, below).
          bytes = await readFile(path);
          const p = await prepareUpload(f.name, bytes);
          if (p.ok) {
            items.push({ file: f, id: randomUUID(), sha: sha256(bytes), prepared: p });
            const tooLarge = pileTooLarge(
              items.flatMap((x) => (x.prepared ? [x.prepared.body.length] : [])),
            );
            if (tooLarge) {
              await fail(tooLarge);
              return;
            }
            continue;
          }
          problem = p.message;
        }
        items.push({
          file: f,
          id: randomUUID(),
          // Never sent, so never anyone's original: a digest of nothing it holds.
          sha: sha256(bytes ?? Buffer.from(`not-read:${scanId}:${f.tmp}`)),
          problem,
        });
      }

      // 2. Copies, the exact estimate and the budget, under the per-firm lock.
      const instructions = await this.instructions();
      const instr = instructionTokens(instructions);
      const now = this.settings.now();
      const planned = await this.prisma.$transaction(async (tx) => {
        await this.lockBudget(tx, scan.firmId);
        const readable = items.filter((x) => x.prepared);
        const earlier = await tx.receiptScanFile.findMany({
          where: {
            clientId: scan.clientId,
            sha256: { in: readable.map((x) => x.sha) },
            estimatedUsd: { gt: 0 },
            result: { in: ["pending", "read", "not-a-receipt", "unreadable"] },
            scan: { status: { in: ["reading", "ready", "approved"] } },
          },
          orderBy: [{ createdAt: "asc" }, { position: "asc" }],
          select: { id: true, sha256: true, name: true, createdAt: true },
        });
        const firstEarlier = new Map<string, (typeof earlier)[number]>();
        for (const e of earlier)
          if (!firstEarlier.has(e.sha256)) firstEarlier.set(e.sha256, e);
        const firstInPile = new Map<string, { id: string; name: string }>();
        const rows = items.map((x, position) => {
          if (!x.prepared) return { ...x, position, copy: null, key: null, estimate: 0 };
          const prior = firstEarlier.get(x.sha);
          const inPile = firstInPile.get(x.sha);
          const copy = prior
            ? {
                of: prior.id,
                problem: COPY_EARLIER(
                  prior.name,
                  prior.createdAt.toISOString().slice(0, 10),
                ),
              }
            : inPile
              ? { of: inPile.id, problem: COPY_IN_PILE(inPile.name) }
              : null;
          if (!copy) firstInPile.set(x.sha, { id: x.id, name: x.file.name });
          const ext = x.prepared.kind === "pdf" ? "pdf" : "jpg";
          return {
            ...x,
            position,
            copy,
            // Only an upload is kept in the bucket; a Drive file stays in Drive.
            key:
              copy || x.file.source === "drive"
                ? null
                : `receipt-scans/${scan.firmId}/${scanId}/${x.id}.${ext}`,
            estimate: copy
              ? 0
              : fileEstimateUsd(
                  settings.model,
                  x.prepared.contentTokens,
                  instr,
                  textTokens(textFor(x.file.name)),
                ),
          };
        });
        const total = round6(rows.reduce((a, r) => a + r.estimate, 0));
        const used = await this.budgetUsed(tx, scan.firmId, scan.month, scanId);
        if (used + total > settings.budget + 1e-9) {
          await tx.receiptScan.update({
            where: { id: scanId },
            data: {
              status: "failed",
              problem: overBudget(total, used, settings),
              estimatedUsd: total,
              inputJson: Prisma.DbNull,
            },
          });
          return null;
        }
        await tx.receiptScanFile.createMany({
          data: rows.map((r) => ({
            id: r.id,
            scanId,
            clientId: scan.clientId,
            position: r.position,
            name: r.file.name,
            contentType:
              r.prepared?.contentType ?? r.file.mimeType ?? "application/octet-stream",
            bytes: r.file.bytes,
            sha256: r.sha,
            storageKey: r.key,
            source: r.file.source,
            driveFileId: r.file.driveFileId ?? null,
            result: r.problem
              ? "unreadable"
              : r.copy
                ? "copy-of-another-file"
                : "pending",
            problem: r.problem ?? r.copy?.problem ?? null,
            copyOfFileId: r.copy?.of ?? null,
            promptVersion: RECEIPTS_PROMPT_VERSION,
            width: r.prepared?.kind === "image" ? r.prepared.width : null,
            height: r.prepared?.kind === "image" ? r.prepared.height : null,
            pages: r.prepared?.kind === "pdf" ? r.prepared.pages : null,
            estimatedUsd: r.estimate,
            createdAt: now,
          })),
        });
        await tx.receiptScan.update({
          where: { id: scanId },
          data: { estimatedUsd: total },
        });
        return { rows, total };
      });
      if (!planned) return;

      // 3. Store the uploads, then send one batch.
      const toSend = planned.rows.filter((r) => r.prepared && !r.copy);
      const stored: string[] = [];
      const unstore = async () => {
        for (const key of stored)
          await this.storage.deleteObject(key).catch(() => undefined);
      };
      try {
        for (const r of toSend) {
          if (!r.key) continue;
          await this.storage.putObject(r.key, r.prepared!.body, r.prepared!.contentType);
          stored.push(r.key);
        }
      } catch (err) {
        this.logger.error(
          `pile ${scanId}: storing failed (${(err as Error).name}); nothing sent`,
        );
        await unstore();
        await fail(STORE_FAILED);
        return;
      }
      if (toSend.length === 0) {
        // Every file was a copy or could not be read: nothing to send or charge.
        await this.prisma.receiptScan.updateMany({
          where: { id: scanId, status: "preparing" },
          data: { status: "ready", actualUsd: 0, readyAt: now, inputJson: Prisma.DbNull },
        });
        return;
      }
      const requests: BatchRequest[] = toSend.map((r) => ({
        custom_id: r.id,
        params: this.requestParams(
          settings.model,
          instructions,
          r.prepared!,
          textFor(r.file.name),
        ),
      }));
      let batchId: string;
      try {
        batchId = (await this.ai.createBatch(requests)).id;
      } catch (err) {
        this.logger.error(
          `pile ${scanId}: the batch was refused (${(err as Error).name}); files removed`,
        );
        await unstore();
        await fail(BATCH_REFUSED);
        return;
      }
      await this.prisma.receiptScan.update({
        where: { id: scanId },
        data: { status: "reading", batchId, inputJson: Prisma.DbNull },
      });
      this.logger.log(
        `pile ${scanId}: ${planned.rows.length} file(s), ${toSend.length} sent, estimate US$${planned.total.toFixed(6)}`,
      );
    } catch (err) {
      this.logger.error(`pile ${scanId}: preparing failed (${(err as Error).name})`);
      await fail(PREPARE_FAILED).catch(() => undefined);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * R3: a pile left "preparing" for 30 minutes that this process is not preparing
   * (the API restarted) ends "failed"; its reservation is released and its
   * temporary files removed. Nothing was sent or charged.
   */
  async endStalePreparing(active: ReadonlySet<string>): Promise<number> {
    const now = this.settings.now();
    const stale = await this.prisma.receiptScan.findMany({
      where: {
        status: "preparing",
        createdAt: { lt: new Date(now.getTime() - PREPARING_FOR_MS) },
      },
      select: { id: true },
    });
    let ended = 0;
    for (const s of stale) {
      if (active.has(s.id)) continue;
      const res = await this.prisma.receiptScan.updateMany({
        where: { id: s.id, status: "preparing" },
        data: {
          status: "failed",
          problem: PREPARING_RESTARTED,
          actualUsd: 0,
          inputJson: Prisma.DbNull,
        },
      });
      await rm(pileDir(s.id), { recursive: true, force: true }).catch(() => undefined);
      ended += res.count;
    }
    if (ended > 0)
      this.logger.warn(`${ended} pile(s) left preparing by a restart: failed`);
    await this.sweepPileFolders(active);
    return ended;
  }

  /** A pile's folder whose pile is no longer preparing (the API stopped between
   *  sending it and removing the folder) is removed: nothing waits on it. */
  private async sweepPileFolders(active: ReadonlySet<string>): Promise<void> {
    const root = join(SCAN_UPLOAD_DIR, "piles");
    const ids = (await readdir(root).catch(() => [] as string[])).filter(
      (id) => UUID.test(id) && !active.has(id),
    );
    if (ids.length === 0) return;
    const preparing = new Set(
      (
        await this.prisma.receiptScan.findMany({
          where: { id: { in: ids }, status: "preparing" },
          select: { id: true },
        })
      ).map((s) => s.id),
    );
    for (const id of ids)
      if (!preparing.has(id))
        await rm(join(root, id), { recursive: true, force: true }).catch(() => undefined);
  }

  /** One request: the cached instructions, then the file and the request's own text. */
  private requestParams(
    model: AiModel,
    instructions: string,
    p: Extract<Prepared, { ok: true }>,
    text: string,
  ): Record<string, unknown> {
    const data = p.body.toString("base64");
    const file =
      p.kind === "pdf"
        ? {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data },
          }
        : { type: "image", source: { type: "base64", media_type: "image/jpeg", data } };
    return {
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: [
        {
          type: "text",
          text: instructions,
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            file,
            {
              type: "text",
              text,
            },
          ],
        },
      ],
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: ANSWER_JSON_SCHEMA },
      },
    };
  }

  /** The cached prefix: the versioned rules and the template's allowed accounts. */
  private async instructions(): Promise<string> {
    const accounts = (await this.expenseImport.templateAccounts()).filter(
      (a) => a.allowed,
    );
    const described = await this.prisma.chartAccount.findMany({
      where: { code: { in: accounts.map((a) => a.code) } },
      select: { code: true, description: true },
    });
    const useFor = new Map(described.map((d) => [d.code, d.description?.trim() || null]));
    return buildInstructions(
      accounts.map((a) => ({
        code: a.code,
        name: a.name,
        useFor: useFor.get(a.code) ?? null,
      })),
    );
  }

  // ------------------------------------------------------------ collect (R9)

  /** Every pile still reading: collect the ended ones; fail the never-sent ones. */
  async collectAll(): Promise<void> {
    const now = this.settings.now();
    const unsent = await this.prisma.receiptScan.updateMany({
      where: {
        status: "reading",
        batchId: null,
        createdAt: { lt: new Date(now.getTime() - UNSENT_AFTER_MS) },
      },
      data: { status: "failed", problem: NOT_SENT, actualUsd: 0 },
    });
    if (unsent.count > 0)
      this.logger.warn(`${unsent.count} pile(s) were never sent; marked failed`);
    const reading = await this.prisma.receiptScan.findMany({
      where: { status: "reading", batchId: { not: null } },
      select: { id: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    for (const s of reading) {
      try {
        await this.collect(s.id);
      } catch (err) {
        if (now.getTime() - s.createdAt.getTime() > GIVE_UP_AFTER_MS) {
          await this.giveUp(s.id);
          this.logger.error(
            `pile ${s.id}: collecting kept failing (${(err as Error).name}); gave up`,
          );
        } else {
          this.logger.error(
            `pile ${s.id}: collecting failed (${(err as Error).name}); will retry`,
          );
        }
      }
    }
  }

  /** R9: a pile never stays "reading" for ever. Its estimate (an upper bound) is
   *  counted as spent, since the batch may have been billed. */
  private async giveUp(scanId: string): Promise<void> {
    const scan = await this.prisma.receiptScan.findUniqueOrThrow({
      where: { id: scanId },
    });
    await this.prisma.$transaction([
      this.prisma.receiptScan.updateMany({
        where: { id: scanId, status: "reading" },
        data: {
          status: "failed",
          problem: COLLECT_GAVE_UP,
          actualUsd: scan.estimatedUsd,
          collectingAt: null,
        },
      }),
      this.prisma.receiptScanFile.updateMany({
        where: { scanId, result: "pending" },
        data: { result: "failed", problem: COLLECT_GAVE_UP },
      }),
    ]);
  }

  /** Whether the poller has work: a pile being read, or one being prepared (U14). */
  async anyReading(): Promise<boolean> {
    return (
      (await this.prisma.receiptScan.count({
        where: { status: { in: ["reading", "preparing"] } },
      })) > 0
    );
  }

  /**
   * Collect one pile once (R9). A lease (collectingAt) keeps a second instance out
   * while this one reads; the status flips from "reading" only inside the
   * transaction that writes the results, so a pile's results are never counted
   * twice — a second attempt finds it no longer reading and does nothing.
   */
  async collect(scanId: string): Promise<"collected" | "waiting" | "skipped"> {
    const now = this.settings.now();
    const lease = await this.prisma.receiptScan.updateMany({
      where: {
        id: scanId,
        status: "reading",
        batchId: { not: null },
        OR: [
          { collectingAt: null },
          { collectingAt: { lt: new Date(now.getTime() - LEASE_MS) } },
        ],
      },
      data: { collectingAt: now },
    });
    if (lease.count !== 1) return "skipped";
    const release = () =>
      this.prisma.receiptScan.updateMany({
        where: { id: scanId, status: "reading", collectingAt: now },
        data: { collectingAt: null },
      });
    try {
      const scan = await this.prisma.receiptScan.findUniqueOrThrow({
        where: { id: scanId },
        include: {
          files: { orderBy: { position: "asc" } },
          client: {
            select: { id: true, businessName: true, regName: true, taxType: true },
          },
        },
      });
      const batch = await this.ai.retrieveBatch(scan.batchId!);
      if (batch.processing_status !== "ended") {
        await release();
        return "waiting";
      }
      const lines = new Map<string, BatchResultLine>();
      for await (const line of this.ai.batchResults(scan.batchId!))
        lines.set(line.custom_id, line);

      const model = scan.model as AiModel;
      const allowed = new Set(
        (await this.expenseImport.templateAccounts())
          .filter((a) => a.allowed)
          .map((a) => a.code),
      );
      const clientNames = [scan.client.businessName, scan.client.regName ?? ""].filter(
        Boolean,
      );
      let expired = false;
      const outcomes: Array<{
        fileId: string;
        result: ScanFileResult;
        problem: string | null;
        cost: number;
        usage: {
          input: number;
          cacheWrite: number;
          cacheRead: number;
          output: number;
        } | null;
        rows: Array<{ cells: ScanCells; doubts: ScanDoubt[] }>;
      }> = [];
      for (const f of scan.files) {
        if (f.result !== "pending") continue;
        const line = lines.get(f.id);
        const r = line?.result;
        if (!r || r.type === "expired" || r.type === "canceled") {
          expired = true;
          outcomes.push({
            fileId: f.id,
            result: "failed",
            problem: FILE_EXPIRED,
            cost: 0,
            usage: null,
            rows: [],
          });
          continue;
        }
        if (r.type === "errored") {
          outcomes.push({
            fileId: f.id,
            result: "failed",
            problem: FILE_ERRORED,
            cost: 0,
            usage: null,
            rows: [],
          });
          continue;
        }
        const u = r.message.usage;
        const usage = {
          input: u.input_tokens,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          output: u.output_tokens,
        };
        const cost = costOfUsage(model, u); // billed whether or not the answer parses
        const answer = parseAnswer(r.message.content);
        if (!answer) {
          outcomes.push({
            fileId: f.id,
            result: "failed",
            problem: FILE_MALFORMED,
            cost,
            usage,
            rows: [],
          });
          continue;
        }
        outcomes.push({
          fileId: f.id,
          result: answer.result,
          problem:
            answer.result === "read"
              ? null
              : (answer.problem ?? "The AI could not use this file."),
          cost,
          usage,
          rows:
            answer.result === "read"
              ? answer.receipts.map((rc) =>
                  mapReceipt(rc, {
                    clientNames,
                    fileName: f.name,
                    allowedCodes: allowed,
                  }),
                )
              : [],
        });
      }

      // R8: the import's own rules, against the pile's period, without writing.
      const flat = outcomes.flatMap((o) =>
        o.rows.map((row) => ({ fileId: o.fileId, ...row })),
      );
      const checks = await this.expenseImport.checkRows(
        scan.clientId,
        this.regime.requireRegime(scan.client.taxType),
        {
          from: scan.periodFrom.toISOString().slice(0, 10),
          to: scan.periodTo.toISOString().slice(0, 10),
        },
        flat.map((row, i) => ({ rowNumber: i + 1, cells: row.cells })),
      );
      const actual = round6(outcomes.reduce((a, o) => a + o.cost, 0));
      const status: ReceiptScanStatus = expired ? "failed" : "ready";

      await this.prisma.$transaction(async (tx) => {
        const flip = await tx.receiptScan.updateMany({
          where: { id: scanId, status: "reading", collectingAt: now },
          data: {
            status,
            actualUsd: actual,
            readyAt: status === "ready" ? now : null,
            problem: expired ? BATCH_EXPIRED : null,
            collectingAt: null,
          },
        });
        if (flip.count !== 1) throw new AlreadyCollected();
        for (const o of outcomes) {
          const done = await tx.receiptScanFile.updateMany({
            where: { id: o.fileId, result: "pending" },
            data: {
              result: o.result,
              problem: o.problem,
              costUsd: o.cost,
              inputTokens: o.usage?.input ?? null,
              cacheWriteTokens: o.usage?.cacheWrite ?? null,
              cacheReadTokens: o.usage?.cacheRead ?? null,
              outputTokens: o.usage?.output ?? null,
            },
          });
          if (done.count !== 1) throw new AlreadyCollected();
        }
        if (flat.length > 0) {
          await tx.receiptScanRow.createMany({
            data: flat.map((row, i) => {
              const c = checks[i]!;
              const check: ScanCheck = {
                outcome: c.outcome,
                needsReview: c.needsReview,
                messages: c.messages,
              };
              return {
                scanId,
                fileId: row.fileId,
                position: i,
                cellsJson: row.cells as unknown as Prisma.InputJsonValue,
                doubtsJson: row.doubts as unknown as Prisma.InputJsonValue,
                checkJson: check as unknown as Prisma.InputJsonValue,
              };
            }),
          });
        }
      });

      const count = (res: ScanFileResult) =>
        outcomes.filter((o) => o.result === res).length;
      await this.audit.record({
        userId: scan.createdById,
        action: "ai.receipt-scan.ready",
        entityType: "ReceiptScan",
        entityId: scanId,
        metadata: {
          clientId: scan.clientId,
          status,
          actualUsd: actual,
          read: count("read"),
          notAReceipt: count("not-a-receipt"),
          unreadable: count("unreadable"),
          failed: count("failed"),
          rows: flat.length,
        },
      });
      this.logger.log(
        `pile ${scanId}: ${status}, ${outcomes.length} result(s), ${flat.length} row(s), actual US$${actual.toFixed(6)}`,
      );
      return "collected";
    } catch (err) {
      if (err instanceof AlreadyCollected) return "skipped";
      await release().catch(() => undefined);
      throw err;
    }
  }

  // ------------------------------------------------------------ Drive (U14 R2)

  /**
   * GET /receipt-scans/drive: the client's linked folder and what is in it, newest
   * first. alreadyRead: an earlier pile of this client sent the file, or matched it
   * as a copy. problem: why it cannot be sent; null when it can.
   */
  async driveListing(user: AuthUser, clientId: string | undefined) {
    if (!clientId || !UUID.test(clientId))
      throw new BadRequestException("clientId is not a client id.");
    await this.rbac.assertClient(user, ["Expenses:Create"], clientId);
    const client = await this.drive.clientOf(user, clientId);
    await this.drive.requireDrive();
    const folder = this.drive.folderOf(client);
    if (!folder) return { folder: null, files: [], truncated: false };
    const { files, truncated } = await this.drive.listFolderTree(folder.id);
    const read = await this.prisma.receiptScanFile.findMany({
      where: {
        clientId,
        source: "drive",
        driveFileId: { in: files.map((f) => f.id) },
        OR: [
          { result: "copy-of-another-file" },
          {
            estimatedUsd: { gt: 0 },
            result: { in: ["pending", "read", "not-a-receipt", "unreadable"] },
            scan: { status: { in: ["reading", "ready", "approved"] } },
          },
        ],
      },
      select: { driveFileId: true },
    });
    const already = new Set(read.map((r) => r.driveFileId));
    return {
      folder,
      files: files.map((f) => ({
        driveFileId: f.id,
        name: f.name,
        path: f.path,
        mimeType: f.mimeType,
        bytes: f.size,
        modifiedTime: f.modifiedTime,
        alreadyRead: already.has(f.id),
        problem: listingProblem(f),
      })),
      truncated,
    };
  }

  /**
   * GET /receipt-scans/files/:fileId/content (U14 contract C): a Drive file's image
   * behind a signed link (image-link.ts), read from Drive as it is opened: a JPEG
   * prepared exactly as for the AI (upright, no EXIF), or the PDF. Nothing is
   * stored; the temporary copy is removed. 404 when Drive no longer has it.
   */
  async driveFileContent(
    fileId: string,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    if (!UUID.test(fileId)) return null;
    const f = await this.prisma.receiptScanFile.findUnique({ where: { id: fileId } });
    if (!f || f.source !== "drive" || !f.driveFileId) return null;
    const dir = join(SCAN_UPLOAD_DIR, "views");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${randomUUID()}`);
    try {
      const got = await this.driveApi.download(f.driveFileId, path, MAX_DRIVE_FILE_BYTES);
      if (got !== "ok") return null;
      const bytes = await readFile(path);
      const p = await prepareUpload(f.name, bytes);
      if (!p.ok) return null;
      return { body: p.body, contentType: p.contentType };
    } catch (err) {
      this.logger.error(`file ${fileId}: Drive image failed (${(err as Error).name})`);
      return null;
    } finally {
      await rm(path, { force: true }).catch(() => undefined);
    }
  }

  // ------------------------------------------------------------ reads (routes 4, 5)

  async list(user: AuthUser, clientId?: string): Promise<ReceiptScanSummary[]> {
    await this.requireAvailable(user.firmId); // R3: every AI route but the status
    if (clientId !== undefined && !UUID.test(clientId))
      throw new BadRequestException("clientId is not a client id.");
    const scope = await this.rbac.authorizedClients(user, ["Expenses:Create"]);
    const where: Prisma.ReceiptScanWhereInput = { firmId: user.firmId };
    if (scope !== "all") where.clientId = { in: [...scope] };
    if (clientId) {
      if (scope !== "all" && !scope.has(clientId)) {
        await this.rbac.assertClient(user, ["Expenses:Create"], clientId);
      }
      where.clientId = clientId;
    }
    const rows = await this.prisma.receiptScan.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: this.summaryInclude,
    });
    return rows.map((r) => this.toSummary(r));
  }

  async detail(user: AuthUser, id: string): Promise<ReceiptScanDetail> {
    await this.requireAvailable(user.firmId); // R3: every AI route but the status
    if (!UUID.test(id)) throw new NotFoundException("Receipt scan not found");
    const scan = await this.prisma.receiptScan.findFirst({
      where: { id, firmId: user.firmId },
      include: {
        ...this.summaryInclude,
        files: {
          orderBy: { position: "asc" },
          include: { rows: { orderBy: { position: "asc" } } },
        },
      },
    });
    if (!scan) throw new NotFoundException("Receipt scan not found");
    await this.rbac.assertClient(user, ["Expenses:Create"], scan.clientId);
    const files: ScanFile[] = [];
    for (const f of scan.files) {
      const drive = f.source === "drive" && f.driveFileId;
      files.push({
        id: f.id,
        name: f.name,
        contentType: f.contentType,
        bytes: f.bytes,
        // U14: an upload's from the bucket; a Drive file's through the API, signed,
        // read from Drive when it is opened. Nothing to show for an unread file.
        imageUrl: drive
          ? f.contentType === "image/jpeg" || f.contentType === "application/pdf"
            ? imageLink(
                imageLinkSecret(this.config),
                this.config.get<string>("API_PUBLIC_URL", "") ?? "",
                f.id,
                this.settings.now(),
              )
            : null
          : f.storageKey && this.storage.isEnabled()
            ? await this.storage.signedGetUrl(f.storageKey)
            : null,
        source: f.source as ScanFile["source"],
        driveLink: drive ? fileLink(f.driveFileId!) : null,
        result: f.result as ScanFileResult,
        problem: f.problem,
        rows: f.rows.map((r): ScanRow => ({
          id: r.id,
          cells: r.cellsJson as unknown as ScanCells,
          doubts: r.doubtsJson as unknown as ScanDoubt[],
          check: r.checkJson as unknown as ScanCheck,
        })),
      });
    }
    const rows = files.flatMap((f) => f.rows);
    const count = (o: ScanCheck["outcome"]) =>
      rows.filter((r) => r.check.outcome === o).length;
    const gross = rows
      .filter((r) => r.check.outcome !== "rejected")
      .reduce(
        (a, r) =>
          a +
          (typeof r.cells["Gross Total"] === "number"
            ? (r.cells["Gross Total"] as number)
            : 0),
        0,
      );
    return {
      scan: this.toSummary(scan),
      files,
      totals: {
        files: files.length,
        rows: rows.length,
        posted: count("posted"),
        held: count("held"),
        rejected: count("rejected"),
        grossAmount: Math.round(gross * 100) / 100,
      },
    };
  }

  private readonly summaryInclude = {
    client: { select: { businessName: true } },
    createdBy: { select: { fullName: true } },
    _count: { select: { files: true, rows: true } },
  } as const;

  private toSummary(
    s: Prisma.ReceiptScanGetPayload<{ include: ReceiptScanService["summaryInclude"] }>,
  ): ReceiptScanSummary {
    return {
      id: s.id,
      clientId: s.clientId,
      clientName: s.client.businessName,
      periodFrom: s.periodFrom.toISOString().slice(0, 10),
      periodTo: s.periodTo.toISOString().slice(0, 10),
      status: s.status as ReceiptScanStatus,
      model: s.model,
      fileCount:
        s.status === "preparing"
          ? ((s.inputJson as unknown as PileInput | null)?.files.length ?? 0)
          : s._count.files,
      rowCount: s._count.rows,
      estimatedUsd: Number(s.estimatedUsd),
      actualUsd: s.actualUsd === null ? null : Number(s.actualUsd),
      createdAt: s.createdAt.toISOString(),
      createdByName: s.createdBy?.fullName ?? "A former user",
      readyAt: s.readyAt ? s.readyAt.toISOString() : null,
      problem: s.problem,
    };
  }
}
