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
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
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
} from "./estimate";
import { RECEIPTS_PROMPT_VERSION, buildInstructions } from "./instructions";
import { mapReceipt } from "./mapping";
import { prepareUpload, sha256, type Prepared } from "./prepare";
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
const COPY_IN_PILE = (name: string) =>
  `An exact copy of ${name} in this pile; it was not sent again.`;
const COPY_EARLIER = (name: string, on: string) =>
  `An exact copy of ${name}, sent on ${on}; it was not sent again.`;

const MAX_FILES = 100;
/** A collecting instance holds its lease this long before another may take over. */
const LEASE_MS = 15 * 60 * 1000;
/** A pile still without a batch after this long was never sent. */
const UNSENT_AFTER_MS = 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the multipart interceptor hands over for each file. */
export interface UploadedScanFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

class AlreadyCollected extends Error {}

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
  ) {}

  // ------------------------------------------------------------ availability

  /** 503 unless the key is set, AI is switched on, and storage is set up (R3). */
  private async requireAvailable(firmId: string) {
    const s = await this.settings.settings(firmId);
    if (!aiKeyConfigured()) throw new ServiceUnavailableException(AI_NOT_SET_UP);
    if (!s.enabled) throw new ServiceUnavailableException(AI_SWITCHED_OFF);
    if (!this.storage.isEnabled()) throw new ServiceUnavailableException(STORAGE_OFF);
    return s;
  }

  // ------------------------------------------------------------ estimate (route 2)

  async estimateRoute(user: AuthUser, images: number, pdfs: number) {
    const s = await this.settings.settings(user.firmId);
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

  async create(
    user: AuthUser,
    query: { clientId?: string; periodFrom?: string; periodTo?: string },
    uploads: UploadedScanFile[],
  ): Promise<ReceiptScanSummary> {
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
    // R10 (D42): Expenses:Create for this client, which also means assigned to it.
    await this.rbac.assertClient(user, ["Expenses:Create"], clientId);
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, firmId: user.firmId },
      select: { id: true, businessName: true, regName: true, tin: true },
    });
    if (!client) throw new NotFoundException("Client not found");
    const settings = await this.requireAvailable(user.firmId);
    if (uploads.length === 0) throw new BadRequestException(NO_FILES);
    if (uploads.length > MAX_FILES)
      throw new BadRequestException(`A pile holds at most ${MAX_FILES} files.`);

    // Prepare every file in memory first; one refusal refuses the pile (R4).
    const prepared = [];
    for (const u of uploads) {
      const p = await prepareUpload(u.originalname, u.buffer);
      if (!p.ok) throw new BadRequestException(p.message);
      prepared.push({ upload: u, prepared: p, id: randomUUID(), sha: sha256(u.buffer) });
    }

    // Exact copies: the same uploaded bytes as an earlier file of this client.
    const earlier = await this.prisma.receiptScanFile.findMany({
      where: { clientId, sha256: { in: prepared.map((p) => p.sha) } },
      orderBy: { createdAt: "asc" },
      select: { id: true, sha256: true, name: true, createdAt: true },
    });
    const firstEarlier = new Map<string, (typeof earlier)[number]>();
    for (const e of earlier)
      if (!firstEarlier.has(e.sha256)) firstEarlier.set(e.sha256, e);
    const firstInPile = new Map<string, { id: string; name: string }>();

    const instructions = await this.instructions();
    const instr = instructionTokens(instructions);
    const files = prepared.map((p, position) => {
      const prior = firstEarlier.get(p.sha);
      const inPile = firstInPile.get(p.sha);
      const copy = prior
        ? {
            of: prior.id,
            problem: COPY_EARLIER(prior.name, prior.createdAt.toISOString().slice(0, 10)),
          }
        : inPile
          ? { of: inPile.id, problem: COPY_IN_PILE(inPile.name) }
          : null;
      if (!copy) firstInPile.set(p.sha, { id: p.id, name: p.upload.originalname });
      const ext = p.prepared.kind === "pdf" ? "pdf" : "jpg";
      return {
        ...p,
        position,
        copy,
        key: copy ? null : `receipt-scans/${user.firmId}/__SCAN__/${p.id}.${ext}`,
        estimate: copy
          ? 0
          : fileEstimateUsd(settings.model, p.prepared.contentTokens, instr),
      };
    });
    const estimate = round6(files.reduce((a, f) => a + f.estimate, 0));

    // R5: the budget, checked and reserved under a per-firm lock, before anything
    // is stored or sent. A refusal stores nothing.
    const now = this.settings.now();
    const month = manilaMonth(now);
    const scanId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${user.firmId}`}))) AS l`;
      const [spentAgg, reservedAgg] = await Promise.all([
        tx.receiptScan.aggregate({
          where: { firmId: user.firmId, month },
          _sum: { actualUsd: true },
        }),
        tx.receiptScan.aggregate({
          where: { firmId: user.firmId, month, status: "reading" },
          _sum: { estimatedUsd: true },
        }),
      ]);
      const used =
        Number(spentAgg._sum.actualUsd ?? 0) + Number(reservedAgg._sum.estimatedUsd ?? 0);
      if (used + estimate > settings.budget + 1e-9) {
        const left = Math.max(0, settings.budget - used);
        throw new ConflictException(
          `This pile would cost about ${money(estimate, settings.usdToPhp, "up")}, but only ` +
            `${money(left, settings.usdToPhp, "down")} is left of this month's ` +
            `US$${settings.budget.toFixed(2)} AI budget. Nothing was sent.`,
        );
      }
      await tx.receiptScan.create({
        data: {
          id: scanId,
          firmId: user.firmId,
          clientId,
          periodFrom: isoToDate(periodFrom),
          periodTo: isoToDate(periodTo),
          status: "reading",
          model: settings.model,
          promptVersion: RECEIPTS_PROMPT_VERSION,
          month,
          estimatedUsd: estimate,
          createdById: user.id,
          createdAt: now,
        },
      });
      await tx.receiptScanFile.createMany({
        data: files.map((f) => ({
          id: f.id,
          scanId,
          clientId,
          position: f.position,
          name: f.upload.originalname,
          contentType: f.prepared.contentType,
          bytes: f.upload.size,
          sha256: f.sha,
          storageKey: f.key?.replace("__SCAN__", scanId) ?? null,
          result: f.copy ? "copy-of-another-file" : "pending",
          problem: f.copy?.problem ?? null,
          copyOfFileId: f.copy?.of ?? null,
          promptVersion: RECEIPTS_PROMPT_VERSION,
          width: f.prepared.kind === "image" ? f.prepared.width : null,
          height: f.prepared.kind === "image" ? f.prepared.height : null,
          pages: f.prepared.kind === "pdf" ? f.prepared.pages : null,
          estimatedUsd: f.estimate,
          createdAt: now,
        })),
      });
    });

    const toSend = files.filter((f) => !f.copy);
    const stored: string[] = [];
    const discard = async () => {
      for (const key of stored)
        await this.storage.deleteObject(key).catch(() => undefined);
      await this.prisma.receiptScan
        .delete({ where: { id: scanId } })
        .catch(() => undefined);
    };

    try {
      for (const f of toSend) {
        const key = f.key!.replace("__SCAN__", scanId);
        await this.storage.putObject(key, f.prepared.body, f.prepared.contentType);
        stored.push(key);
      }
    } catch (err) {
      this.logger.error(
        `pile ${scanId}: storing failed (${(err as Error).name}); nothing sent`,
      );
      await discard();
      throw new BadGatewayException(STORE_FAILED);
    }

    if (toSend.length === 0) {
      // Every file was a copy: nothing to read, nothing charged.
      await this.prisma.receiptScan.update({
        where: { id: scanId },
        data: { status: "ready", actualUsd: 0, readyAt: now },
      });
    } else {
      const requests: BatchRequest[] = toSend.map((f) => ({
        custom_id: f.id,
        params: this.requestParams(settings.model, instructions, f.prepared, {
          buyer: client.regName?.trim() || client.businessName,
          tin: client.tin,
          periodFrom,
          periodTo,
          fileName: f.upload.originalname,
        }),
      }));
      let batchId: string;
      try {
        batchId = (await this.ai.createBatch(requests)).id;
      } catch (err) {
        // R6: the pile is not kept; nothing was charged.
        this.logger.error(
          `pile ${scanId}: the batch was refused (${(err as Error).name}); files removed`,
        );
        await discard();
        throw new BadGatewayException(BATCH_REFUSED);
      }
      await this.prisma.receiptScan.update({ where: { id: scanId }, data: { batchId } });
    }

    await this.audit.record({
      userId: user.id,
      action: "ai.receipt-scan.create",
      entityType: "ReceiptScan",
      entityId: scanId,
      metadata: {
        clientId,
        fileCount: files.length,
        sentCount: toSend.length,
        estimatedUsd: estimate,
      },
    });
    this.logger.log(
      `pile ${scanId}: ${files.length} file(s), ${toSend.length} sent, estimate US$${estimate.toFixed(6)}`,
    );
    return this.summary(user, scanId);
  }

  /** One request: the cached instructions, then the file and the request's own text. */
  private requestParams(
    model: AiModel,
    instructions: string,
    p: Extract<Prepared, { ok: true }>,
    ctx: {
      buyer: string;
      tin: string | null;
      periodFrom: string;
      periodTo: string;
      fileName: string;
    },
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
              text:
                `The client (the buyer, never the vendor): ${ctx.buyer}, TIN ${ctx.tin ?? "not on file"}.\n` +
                `Period: ${ctx.periodFrom} to ${ctx.periodTo}.\n` +
                `File name: ${ctx.fileName}`,
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
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    for (const s of reading) {
      try {
        await this.collect(s.id);
      } catch (err) {
        this.logger.error(
          `pile ${s.id}: collecting failed (${(err as Error).name}); will retry`,
        );
      }
    }
  }

  async anyReading(): Promise<boolean> {
    return (await this.prisma.receiptScan.count({ where: { status: "reading" } })) > 0;
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

  // ------------------------------------------------------------ reads (routes 4, 5)

  async list(user: AuthUser, clientId?: string): Promise<ReceiptScanSummary[]> {
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
      files.push({
        id: f.id,
        name: f.name,
        contentType: f.contentType,
        bytes: f.bytes,
        imageUrl:
          f.storageKey && this.storage.isEnabled()
            ? await this.storage.signedGetUrl(f.storageKey)
            : null,
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

  private async summary(user: AuthUser, id: string): Promise<ReceiptScanSummary> {
    const s = await this.prisma.receiptScan.findFirstOrThrow({
      where: { id, firmId: user.firmId },
      include: this.summaryInclude,
    });
    return this.toSummary(s);
  }

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
      fileCount: s._count.files,
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
