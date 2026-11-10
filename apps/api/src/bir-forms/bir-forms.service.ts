import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  BirPdfError,
  loadMap as loadPrintMap,
  parseEbirExport,
  renderReturn,
} from "@portal/bir-pdf";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { ClientsService } from "../clients/clients.service";
import { PrismaService } from "../prisma/prisma.service";
import { RbacService } from "../rbac/rbac.service";
import { StorageService } from "../storage/storage.service";
import { CONFIRMATION_FORMS, MESSAGES, MIN_REASON_LENGTH } from "../bir-confirmation/confirmation-forms";
import type { ConfirmationResult } from "../bir-confirmation/confirmation-checks";
import { ConfirmationService, uploadedFileName } from "../bir-confirmation/confirmation.service";
import { BIR_FORM_CATALOG } from "./bir-forms.constants";
import {
  AlphalistService,
  FILING_WARNING,
  ONLY_1601EQ,
} from "./alphalist/alphalist.service";
import { readStoredAlphalist, storedAlphalist } from "./alphalist/stored";
import { qapFileName, writeQap } from "./alphalist/qap-writer";
import { clientToTaxpayer } from "./client-mapping";
import { assertValidDraftSource } from "./draft-source";
import {
  PRINTED_NOT_XML,
  WITHHOLDING_FORMS,
  checkWithholdingPeriod,
  sixRowsRefusal,
} from "./withholding";
import {
  type FiledSnapshot,
  readFiledSnapshot,
  snapshotToClient,
  takeFiledSnapshot,
} from "./filed-snapshot";
import {
  build1701,
  build1701A,
  build1701Q,
  build1702Q,
  build1702RT,
  build2550Q,
  build2551Q,
  build2307PrintRows,
  certificateFileName,
  compute0619E,
  compute1601C,
  compute1601EQ,
  compute1701,
  compute1701A,
  compute1701Q,
  compute1702Q,
  compute1702RT,
  compute2307,
  compute2316,
  compute2550Q,
  compute2551Q,
  ExportRefusal,
  manilaDate,
  fileName1701,
  fileName1701A,
  fileName1701Q,
  fileName1702Q,
  fileName1702RT,
  fileName2550Q,
  fileName2551Q,
  type Build2550QOptions,
  type Filing,
  type FilingData,
  type FormCode,
  type Taxpayer,
} from "./engine";
import {
  WITHHOLDING_PRINT_VERSION,
  buildWithholdingPrintRows,
  withholdingPrintBaseName,
  type WithholdingPrintForm,
} from "./engine/withholding-print";
import {
  CONTACT_FORMS,
  contactNumberOf,
  contactRefusal,
  normalisedContact,
  printRowsWithContact,
  validContact,
} from "./engine/contact-number";
import type { CreateBirFormInput, UpdateBirFormInput } from "./dto/bir-form.schemas";

/** Forms whose engine has been ported and are usable end-to-end. */
export const AVAILABLE_FORMS = new Set([
  "2551Q",
  "2550Q",
  "1701Q",
  "1701A",
  "1701",
  "1702Q",
  "1702RT",
  "2307",
  "2316",
  // U17 (D57): the withholding returns. Printed, never exported as eBIRForms XML.
  "0619E",
  "1601EQ",
  "1601C",
]);

/**
 * Forms that produce an eBIRForms XML artifact — i.e. the *returns* you e-file.
 * 2307 and 2316 are deliberately absent: they are **certificates issued** to a
 * payee / employee, not returns, so BIR defines no XML for them. Those are
 * printed from the web UI as an A4 PDF of the faithful form sheet instead.
 */
export const XML_EXPORT_FORMS = new Set([
  "2551Q",
  "2550Q",
  "1701Q",
  "1701A",
  "1701",
  "1702Q",
  "1702RT",
]);

/**
 * U13 (D50): the eBIRForms version each return's builder writes, which is the
 * BIR blank a clear copy prints on. A return prints once @portal/bir-pdf has a
 * field map for its form and version; until then its clear copy is "not
 * available yet".
 */
export const CLEAR_COPY_VERSION: Record<string, string> = {
  "2551Q": "2018-01",
  "2550Q": "2024-04",
  "1701Q": "2018-01",
  "1701A": "2018-01",
  "1701": "2018-01",
  "1702Q": "2018-01",
  "1702RT": "2018-01",
  // C7 (D56): the certificate has no eBIRForms export; its rows come from
  // build2307PrintRows, but it prints on the BIR's own blank the same way.
  "2307": "2018-01",
  // C9 (D57): the withholding returns are printed, never exported; their rows come from
  // buildWithholdingPrintRows. Each prints on the BIR's own blank of its own version.
  "0619E": WITHHOLDING_PRINT_VERSION["0619E"],
  "1601EQ": WITHHOLDING_PRINT_VERSION["1601EQ"],
  "1601C": WITHHOLDING_PRINT_VERSION["1601C"],
};

/** U13 R1: the refusal for a draft. */
export const CLEAR_COPY_DRAFT =
  "Mark the return as filed first; a clear copy shows what was filed.";

const printMapsLoaded = new Set<string>();
const birLog = new Logger("BirForms");

/**
 * True when the print engine has a usable field map for this form's version. A
 * map that loads is remembered; a missing one is looked for again next time, and
 * one that exists but cannot be read is logged, never thrown at a reader.
 */
export function clearCopyMapped(form: string): boolean {
  const version = CLEAR_COPY_VERSION[form];
  if (!version) return false;
  const key = `${form}-${version}`;
  if (printMapsLoaded.has(key)) return true;
  try {
    loadPrintMap(form, version);
    printMapsLoaded.add(key);
    return true;
  } catch (err) {
    if (!(err instanceof BirPdfError && /no field map for/.test(err.message)))
      birLog.error(`print map ${key} cannot be used: ${(err as Error).message}`);
    return false;
  }
}

/**
 * U22: the client row the filed snapshot is taken from. A contact number that is valid is
 * kept as the 11 digits the return was exported with; anything else is kept as it is.
 */
function withPlainPhone<T extends { phone: string | null }>(c: T): T {
  return c.phone && validContact(c.phone) ? { ...c, phone: normalisedContact(c.phone) } : c;
}

/** True for a print-engine error that is the Portal's fault (a map, the package,
 *  the export's shape), not the return's data: answered 500 and logged, never a
 *  409 the user cannot act on. */
export function isEngineFault(err: unknown): boolean {
  return (
    !(err instanceof BirPdfError) ||
    /appears twice in the export|has no entry in the field map|^eBIRForms export:|^@portal\/bir-pdf:|^map |^field map:|no field map for|unknown form version/.test(
      err.message,
    )
  );
}

/** C3 R2 (D52): the refusals of a draft's preview. */
export const PREVIEW_FILED = "This return is filed. Use Download clear copy.";
export const previewNotAvailable = (form: string) =>
  `A preview of the ${form} is not available yet.`;

/** C3 R2: a draft whose form and version have a print map can be previewed. */
export function previewAvailable(f: { status: string; form: string }): boolean {
  return f.status === "draft" && clearCopyMapped(f.form);
}

/** U14 R4: a filed return is the record of what was filed; it is never deleted. */
export const FILED_NOT_DELETABLE =
  "A filed return can't be deleted; it is the record of what was filed.";

/**
 * The returns: a filed one is corrected by an amendment (U3 R2, D11). The seven that
 * export eBIRForms XML, and (U17) the three withholding returns, which are printed.
 */
export const RETURN_FORMS = new Set([...XML_EXPORT_FORMS, ...WITHHOLDING_FORMS]);

/** The two certificates: no amendment — a mistake is corrected by a new certificate (D20). */
export const CERTIFICATE_FORMS = new Set(["2307", "2316"]);

/** The 409 for any change to a filed form, naming the correction path (U3 B2). */
export function sealedMessage(form: string): string {
  return CERTIFICATE_FORMS.has(form)
    ? `This ${form} has been issued and is sealed: an issued certificate is never changed. ` +
        "To correct it, issue a new certificate; this one stays as issued."
    : `This ${form} has been filed and is sealed: a filed return is never changed. ` +
        "To correct it, file an amendment — Amend opens a new draft that copies this one.";
}

/**
 * The permission each BIR-form operation needs: the route's own (the controller
 * declares these), asked again of the form's client by the service (U4 R2).
 */
export const BIR_FORMS_PERMISSION = {
  read: "BIRForms:Read",
  create: "BIRForms:Create",
  update: "BIRForms:Update",
  file: "BIRForms:File",
} as const;

/** The database trigger bir_forms_seal refused the write (U3 migration). */
function isSealError(err: unknown): boolean {
  return String((err as { message?: unknown })?.message ?? "").includes(
    "BIR_FORM_SEALED",
  );
}

/** An uploaded file, as multer hands it over (memory storage). */
export interface UploadedPdf {
  buffer: Buffer;
  originalname?: string;
  size?: number;
  mimetype?: string;
}

/** What Mark as filed / Attach confirmation receive: a PDF, or an override reason. */
export interface ConfirmationUpload {
  file?: UploadedPdf;
  /** Present (even empty) means an override was asked for. */
  overrideReason?: string;
  replace?: boolean;
}

type ConfirmationBasis =
  | {
      kind: "bir_email";
      bytes: Buffer;
      originalname: string;
      result: ConfirmationResult;
      receivedAt: Date;
    }
  | { kind: "override"; reason: string };

/**
 * Internal BIR Forms module (ported from the Sentire generator). Authoring +
 * authoritative compute + eBIRForms XML export. Every operation is firm-scoped;
 * the target client must belong to the actor's firm. Within the firm, every
 * operation is confined to the clients the caller is authorized for (U4 R2, D14);
 * catalog and compute carry no client data and are not.
 */
@Injectable()
export class BirFormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly confirmations: ConfirmationService,
    private readonly alphalists: AlphalistService,
  ) {}

  /** The BIR form catalog + per-form rollout status. */
  catalog() {
    return BIR_FORM_CATALOG;
  }

  /** Saved BIR forms for the actor's firm, optionally narrowed by client/status. */
  async list(user: AuthUser, clientId?: string, status?: string) {
    const where: Prisma.BirFormWhereInput = {
      firmId: user.firmId,
      ...(await this.clientScope(user, clientId)),
      ...(status ? { status } : {}),
    };
    const rows = await this.prisma.birForm.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: { client: { select: { businessName: true } } },
    });
    // U14 R5, additive: what the list needs without fetching each row's detail.
    const deletable = await this.rbac.authorizedClients(user, [
      BIR_FORMS_PERMISSION.create,
    ]);
    return rows.map((f) => ({
      ...this.toSummary(f),
      clearCopyAvailable: f.status === "filed" && clearCopyMapped(f.form),
      previewAvailable: previewAvailable(f),
      canDelete:
        f.status === "draft" && (deletable === "all" || deletable.has(f.clientId)),
    }));
  }

  /**
   * Filed forms for a client, with their authoritative key figures — this is
   * what the client's tax view surfaces so the *filed* number supersedes the
   * bookkeeping estimate (guardrail #1).
   */
  async listFiled(user: AuthUser, clientId?: string) {
    const rows = await this.prisma.birForm.findMany({
      where: {
        firmId: user.firmId,
        status: "filed",
        ...(await this.clientScope(user, clientId)),
      },
      orderBy: { filedAt: "desc" },
      include: { client: { select: { businessName: true } } },
    });
    return rows.map((f) => ({
      ...this.toSummary(f),
      figures: this.keyFigures(f.form, (f.dataJson ?? {}) as unknown as FilingData),
    }));
  }

  /**
   * U10 R4: one client's filed forms with their key figures, for the tax estimate
   * (filed returns win; guardrail 1). The estimate's route has already authorized
   * the caller on this client; this read is confined to the caller's firm.
   */
  async filedForClient(firmId: string, clientId: string) {
    const rows = await this.prisma.birForm.findMany({
      where: { firmId, clientId, status: "filed" },
      orderBy: { filedAt: "desc" },
    });
    return rows.map((f) => ({
      id: f.id,
      form: f.form,
      period: f.period,
      filedAt: f.filedAt ? f.filedAt.toISOString() : null,
      sequence: f.sequence ?? 1,
      amendsId: f.amendsId ?? null,
      figures: this.keyFigures(f.form, (f.dataJson ?? {}) as unknown as FilingData),
    }));
  }

  async create(user: AuthUser, input: CreateBirFormInput) {
    // U4 R2: create authorizes against the client named in the body.
    await this.rbac.assertClient(user, [BIR_FORMS_PERMISSION.create], input.clientId);
    this.assertSupported(input.form);
    this.assertWithholdingPeriod(input.form, input.period);
    assertValidDraftSource(input.data);
    await this.clients.assertInFirm(user.firmId, input.clientId);
    const created = await this.prisma.birForm.create({
      data: {
        firmId: user.firmId,
        clientId: input.clientId,
        form: input.form,
        period: input.period,
        status: "draft",
        dataJson: input.data as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: "bir-form.create",
      entityType: "BirForm",
      entityId: created.id,
      metadata: { form: input.form, clientId: input.clientId, period: input.period },
    });
    return this.detail(await this.loadOwned(user.firmId, created.id));
  }

  /** One form with its raw data, computed figures, and export list. */
  async getOne(user: AuthUser, id: string) {
    const f = await this.loadAuthorized(user, id, BIR_FORMS_PERMISSION.read);
    return {
      ...this.detail(f),
      // U14, additive: a draft the caller may delete.
      canDelete: f.status === "draft" && (await this.mayDelete(user, f.clientId)),
    };
  }

  /** Whether the caller holds BIRForms:Create on this client (the list's question). */
  private async mayDelete(user: AuthUser, clientId: string): Promise<boolean> {
    const scope = await this.rbac.authorizedClients(user, [BIR_FORMS_PERMISSION.create]);
    return scope === "all" || scope.has(clientId);
  }

  /**
   * U14 R4 (D51): delete a draft return, an amendment draft included. Its exports'
   * rows go with it (the relation cascades); their stored files are removed after
   * the delete commits, a failed removal logged, not raised. The audit row keeps
   * the draft's data. A filed return is never deleted: 409 here, and the database
   * seal (bir_forms_seal) refuses it below us too.
   */
  async remove(user: AuthUser, id: string): Promise<{ deleted: true; id: string }> {
    const f = await this.loadAuthorized(user, id, BIR_FORMS_PERMISSION.create);
    if (f.status === "filed") throw new ConflictException(FILED_NOT_DELETABLE);
    // U22 (D63): a draft that was filed and had its filing undone keeps its history.
    if ((f.filingUndos ?? []).length > 0) {
      throw new ConflictException(MESSAGES.undoneNotDeletable);
    }
    let removed: Array<{ id: string; storageKey: string; filename: string }>;
    try {
      // Its exports read in the same transaction as the delete, so one made a
      // moment ago is removed from storage too.
      removed = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.birFormExport.findMany({
          where: { birFormId: id },
          select: { id: true, storageKey: true, filename: true },
        });
        await tx.birForm.delete({ where: { id } });
        return rows;
      });
    } catch (err) {
      // Filed by someone else between the read above and this delete.
      if (isSealError(err)) throw new ConflictException(FILED_NOT_DELETABLE);
      if ((err as { code?: unknown })?.code === "P2025")
        throw new NotFoundException("Form not found");
      throw err;
    }
    // The draft is gone: what follows is logged if it fails, never a 500.
    await this.audit
      .record({
        userId: user.id,
        action: "bir-form.draft-deleted",
        entityType: "BirForm",
        entityId: id,
        metadata: {
          form: f.form,
          period: f.period,
          sequence: f.sequence ?? 1,
          amendsId: f.amendsId ?? null,
          clientId: f.clientId,
          dataJson: (f.dataJson ?? {}) as Prisma.InputJsonValue,
          exports: removed.map((e) => e.filename),
        },
      })
      .catch((err: unknown) =>
        birLog.error(
          `draft ${id}: deleted, but its audit row failed (${(err as Error).name})`,
        ),
      );
    for (const e of removed) {
      await this.storage
        .deleteObject(e.storageKey)
        .catch((err: unknown) =>
          birLog.error(
            `draft ${id}: its export ${e.id} could not be removed from storage (${(err as Error).name})`,
          ),
        );
    }
    return { deleted: true, id };
  }

  /** The detail view of a loaded form (no authorization: callers have done it). */
  private detail(f: Awaited<ReturnType<BirFormsService["loadOwned"]>>) {
    const data = (f.dataJson ?? {}) as unknown as FilingData;
    return {
      ...this.toSummary(f),
      data,
      computed: AVAILABLE_FORMS.has(f.form) ? this.compute(f.form, data) : null,
      // U13 R2, additive: a filed return whose form and version have a map.
      clearCopyAvailable: f.status === "filed" && clearCopyMapped(f.form),
      // C3 R2, additive: a draft whose form and version have a map.
      previewAvailable: previewAvailable(f),
      // U18 (D58), additive: whether Mark as filed needs the BIR's confirmation e-mail,
      // and the live confirmation (or override) of a filed return; null if it has none.
      alphalist: f.form === "1601EQ" ? this.alphalistState(f) : null,
      confirmationRequired: CONFIRMATION_FORMS.has(f.form),
      confirmation: f.confirmations?.[0] ? this.confirmations.summary(f.confirmations[0]) : null,
      // U22 (D63), additive: the filings taken back (oldest first); [] if none.
      filingUndos: (f.filingUndos ?? []).map((u) => ({
        id: u.id,
        reason: u.reason,
        filedAt: u.filedAt.toISOString(),
        undoneAt: u.undoneAt.toISOString(),
        undoneByUserId: u.undoneByUserId,
        overrideReason: u.overrideReason,
      })),
      exports: f.exports.map((e) => ({
        id: e.id,
        kind: e.kind,
        filename: e.filename,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async update(user: AuthUser, id: string, input: UpdateBirFormInput) {
    const f = await this.loadAuthorized(user, id, BIR_FORMS_PERMISSION.update);
    // U9 R1 c (D44): marking a form filed needs BIRForms:File, whatever route does it.
    if (input.status === "filed") {
      await this.rbac.assertClient(user, [BIR_FORMS_PERMISSION.file], f.clientId);
    }
    // U3 (D11): a filed form is never modified — figures, status or filedAt. There
    // is no reopen; the database trigger bir_forms_seal enforces the same below us.
    if (f.status === "filed") throw new ConflictException(sealedMessage(f.form));
    // U18 (D58): the nine returns are marked filed with the BIR's confirmation, through
    // POST :id/mark-filed. The 1601-C, the 2307 and the 2316 are marked filed here, as before.
    if (input.status === "filed" && CONFIRMATION_FORMS.has(f.form)) {
      throw new ConflictException(MESSAGES.needsConfirmation);
    }
    assertValidDraftSource(input.data);
    if (input.period !== undefined) this.assertWithholdingPeriod(f.form, input.period);
    // U17: a 1601-EQ of more than six ATCs is never marked filed (nothing is dropped).
    if (input.status === "filed") {
      const refusal = sixRowsRefusal(f.form, input.data ?? f.dataJson);
      if (refusal) throw new ConflictException(refusal);
    }
    // An amendment corrects one filed return: it keeps that return's period (R2).
    if (f.amendsId && input.period !== undefined && input.period !== f.period) {
      throw new BadRequestException(
        `This draft amends the ${f.form} for ${f.period} and keeps that period. ` +
          "To correct a different period, amend that period's filed return.",
      );
    }

    // The draft → filed write carries filedAt and the taxpayer snapshot together (D12).
    const filedAt = input.status === "filed" ? new Date() : null;
    const filingClient = filedAt
      ? await this.clients.assertInFirm(user.firmId, f.clientId)
      : null;
    // U21: the 1601-C is marked filed here; like the other returns it needs a contact number.
    if (filingClient)
      this.assertContact(f.form, input.data ?? f.dataJson, filingClient.phone);
    const snapshot =
      filedAt && filingClient
        ? takeFiledSnapshot(withPlainPhone(filingClient), filedAt)
        : null;
    try {
      await this.prisma.birForm.update({
        where: { id },
        data: {
          ...(input.period !== undefined ? { period: input.period } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(filedAt && snapshot
            ? { filedAt, filedSnapshotJson: snapshot as unknown as Prisma.InputJsonValue }
            : input.status === "draft"
              ? // Only a draft reaches here, and a draft's filedAt is already NULL
                // (bir_forms_filed_at_check): this clears nothing, and the trigger
                // refuses NULL over a filedAt that is set. Kept because the existing
                // contract test bir-forms.service.spec.ts asserts it (U3: untouched).
                { filedAt: null }
              : {}),
          ...(input.data !== undefined
            ? { dataJson: input.data as Prisma.InputJsonValue }
            : {}),
        },
      });
    } catch (err) {
      // Filed by someone else between the read above and this write: the trigger refused it.
      if (isSealError(err)) throw new ConflictException(sealedMessage(f.form));
      throw err;
    }
    await this.audit.record({
      userId: user.id,
      action: "bir-form.update",
      entityType: "BirForm",
      entityId: id,
      metadata: {
        fields: Object.keys(input),
        ...(snapshot ? { snapshot: "taken at filing" } : {}),
      },
    });
    return this.detail(await this.loadOwned(user.firmId, id));
  }

  /**
   * U3 (R2, D11, D20): correct a filed return with an amendment — a new draft of the
   * same client, form and period, copying the original's data verbatim (unknown keys
   * included, R6), sequence = original + 1, amendsId = original. The original is not
   * written. Certificates (2307, 2316) have no amendment: a new certificate corrects
   * them. One amendment per form (unique amendsId): a second correction amends the
   * first amendment once it is filed.
   */
  async amend(
    user: AuthUser,
    id: string,
  ): Promise<{ id: string; status: "draft"; sequence: number; amendsId: string }> {
    const f = await this.loadAuthorized(user, id, BIR_FORMS_PERMISSION.create);
    if (CERTIFICATE_FORMS.has(f.form)) {
      throw new BadRequestException(
        `A ${f.form} is a certificate and has no amendment. To correct a mistaken ` +
          `${f.form}, issue a new certificate; this one stays as issued.`,
      );
    }
    if (!RETURN_FORMS.has(f.form)) {
      throw new BadRequestException(`Form ${f.form} cannot be amended.`);
    }
    if (f.status !== "filed") {
      throw new BadRequestException(
        `Only a filed return can be amended. This ${f.form} is still a draft — edit it instead.`,
      );
    }
    const already = await this.prisma.birForm.findFirst({
      where: { amendsId: f.id },
      select: { id: true, sequence: true },
    });
    const alreadyMessage = (seq?: number) =>
      `This ${f.form} has already been amended${seq ? ` (amendment ${seq})` : ""}. ` +
      "Continue that amendment, or amend it once it is filed.";
    if (already) throw new ConflictException(alreadyMessage(already.sequence));

    const sequence = (f.sequence ?? 1) + 1;
    let created: { id: string };
    try {
      created = await this.prisma.birForm.create({
        data: {
          firmId: f.firmId,
          clientId: f.clientId,
          form: f.form,
          period: f.period,
          status: "draft",
          dataJson: (f.dataJson ?? {}) as Prisma.InputJsonValue,
          sequence,
          amendsId: f.id,
        },
      });
    } catch (err) {
      // Two amendments raced; the unique index on amendsId let one through.
      if ((err as { code?: unknown })?.code === "P2002")
        throw new ConflictException(alreadyMessage());
      throw err;
    }
    await this.audit.record({
      userId: user.id,
      action: "bir-form.amended",
      entityType: "BirForm",
      entityId: created.id,
      metadata: { amendsId: f.id, sequence },
    });
    return { id: created.id, status: "draft", sequence, amendsId: f.id };
  }

  /** Authoritative compute for a form + data (no persistence). */
  computePreview(form: string, data: Record<string, unknown>) {
    this.assertSupported(form);
    return this.compute(form, data as unknown as FilingData);
  }

  /**
   * Generate the eBIRForms XML for a saved form, store it in object storage, and
   * record the export. The XML is the authoritative artifact you upload to BIR.
   */
  async exportForm(user: AuthUser, id: string) {
    const f = await this.loadAuthorized(user, id, BIR_FORMS_PERMISSION.file);
    const { xml, filename, snapshotAudit } = await this.buildExport(user, f);

    const key = this.storage.birFormExportKey(user.firmId, f.id, filename);
    await this.storage.putObject(key, new TextEncoder().encode(xml), "application/xml");
    const exportRow = await this.prisma.birFormExport.create({
      data: { birFormId: f.id, kind: "xml", storageKey: key, filename },
    });
    await this.audit.record({
      userId: user.id,
      action: "bir-form.export",
      entityType: "BirForm",
      entityId: f.id,
      metadata: { kind: "xml", filename, ...snapshotAudit },
    });
    return {
      id: exportRow.id,
      kind: "xml",
      filename,
      // U14 R5: a link that downloads, under the export's own name.
      url: await this.storage.signedGetUrl(key, { filename }),
    };
  }

  /**
   * U13 R1 (D50): the client's clear copy of a filed return — the same eBIRForms
   * export exportForm writes (same builder, the D12 filing snapshot, the same
   * taxpayer mapping), printed by @portal/bir-pdf onto the BIR's own blank PDF and
   * stored beside the XML. Downloaded through GET :id/exports/:exportId/url.
   */
  async clearCopy(user: AuthUser, id: string) {
    const f = await this.loadAuthorized(user, id, BIR_FORMS_PERMISSION.file);
    const tooMany = sixRowsRefusal(f.form, f.dataJson);
    if (tooMany) throw new ConflictException(tooMany);
    if (!clearCopyMapped(f.form)) {
      throw new ConflictException(`A clear copy of the ${f.form} is not available yet.`);
    }
    if (f.status !== "filed") throw new ConflictException(CLEAR_COPY_DRAFT);
    const { rows, baseName, snapshotAudit } = await this.printSource(user, f, {
      store: true,
    });
    let pdf: Uint8Array;
    try {
      pdf = await renderReturn(f.form, CLEAR_COPY_VERSION[f.form]!, rows);
    } catch (err) {
      // The engine names the field of the return it cannot print; nothing is
      // stored. A fault of the Portal's own is a 500, not the user's to fix.
      if (!isEngineFault(err)) throw new ConflictException((err as Error).message);
      birLog.error(`clear copy of form ${f.id} failed: ${(err as Error).message}`);
      throw new InternalServerErrorException(
        `The clear copy of this ${f.form} could not be printed. The error is logged.`,
      );
    }
    const filename = `${baseName}.pdf`;
    const key = this.storage.birFormExportKey(user.firmId, f.id, filename);
    await this.storage.putObject(key, pdf, "application/pdf");
    const exportRow = await this.prisma.birFormExport.create({
      data: { birFormId: f.id, kind: "pdf", storageKey: key, filename },
    });
    await this.audit.record({
      userId: user.id,
      action: "bir-form.clear-copy",
      entityType: "BirForm",
      entityId: f.id,
      metadata: {
        kind: "pdf",
        filename,
        version: CLEAR_COPY_VERSION[f.form],
        ...snapshotAudit,
      },
    });
    return {
      id: exportRow.id,
      kind: "pdf" as const,
      filename,
      createdAt: exportRow.createdAt.toISOString(),
    };
  }

  /**
   * C3 R2 (D52): a draft's preview — the same eBIRForms export exportForm writes
   * for a draft (same builder, the same taxpayer mapping, the draft's saved data),
   * printed by @portal/bir-pdf on the BIR's blank and stamped "DRAFT — NOT FILED".
   * Made on request and never stored: no export row, no bucket write, no audit row
   * (it is a read). 409: a form with no print map yet, a filed return, or a field
   * the builder or the engine refuses, in its own words.
   */
  async previewPdf(user: AuthUser, id: string): Promise<{ pdf: Uint8Array; filename: string }> {
    const f = await this.loadAuthorized(user, id, BIR_FORMS_PERMISSION.read);
    const tooMany = sixRowsRefusal(f.form, f.dataJson);
    if (tooMany) throw new ConflictException(tooMany);
    if (!clearCopyMapped(f.form)) throw new ConflictException(previewNotAvailable(f.form));
    if (f.status !== "draft") throw new ConflictException(PREVIEW_FILED);
    const { rows, baseName } = await this.printSource(user, f, { store: false });
    let pdf: Uint8Array;
    try {
      pdf = await renderReturn(f.form, CLEAR_COPY_VERSION[f.form]!, rows, {
        watermark: "DRAFT",
        printedAt: new Date(),
      });
    } catch (err) {
      // As the clear copy: a field of the return the engine cannot print is the
      // user's to fix (409, its own words); a fault of the Portal's own is a 500.
      if (!isEngineFault(err)) throw new ConflictException((err as Error).message);
      birLog.error(`preview of form ${f.id} failed: ${(err as Error).message}`);
      throw new InternalServerErrorException(
        `The preview of this ${f.form} could not be printed. The error is logged.`,
      );
    }
    return { pdf, filename: `${baseName}-DRAFT.pdf` };
  }

  /**
   * What a clear copy or a preview prints: the rows the print engine reads, and the file
   * name (without its extension) they are saved under. The seven returns print their
   * eBIRForms export (buildExport); the 2307 certificate has none, so its rows are built
   * from its own data and its payor block — the filing snapshot once issued (D12), the
   * client's record while it is a draft (C7, D56).
   */
  private async printSource(
    user: AuthUser,
    f: Awaited<ReturnType<BirFormsService["loadOwned"]>>,
    opts: { store: boolean },
  ) {
    if (WITHHOLDING_FORMS.has(f.form)) return this.withholdingPrintSource(user, f);
    if (f.form !== "2307") {
      const { xml, filename, snapshotAudit } = await this.buildExport(user, f, opts);
      return {
        rows: printRowsWithContact(f.form, parseEbirExport(xml)),
        baseName: filename.replace(/\.xml$/i, ""),
        snapshotAudit,
      };
    }
    this.assertSupported(f.form);
    const client = await this.clients.assertInFirm(user.firmId, f.clientId);
    let snapshot: FiledSnapshot | null;
    try {
      snapshot = readFiledSnapshot(f.filedSnapshotJson);
    } catch (err) {
      throw new InternalServerErrorException(`Form ${f.id}: ${(err as Error).message}`);
    }
    const issued = f.status === "filed";
    const payor = issued && snapshot ? snapshot : client;
    const snapshotAudit = snapshot
      ? { snapshot: "used", snapshotTakenAt: snapshot.takenAt }
      : { snapshot: issued ? "none (pre-U3)" : "none (draft)" };
    try {
      const rows = build2307PrintRows((f.dataJson ?? {}) as FilingData, payor, {
        filed: issued,
        period: f.period,
      });
      return {
        rows,
        baseName: certificateFileName("2307", f.period, payor.tin).replace(/\.pdf$/i, ""),
        snapshotAudit,
      };
    } catch (err) {
      if (err instanceof ExportRefusal) throw new ConflictException(err.message);
      throw err;
    }
  }

  /**
   * The rows of a withholding return (0619-E, 1601-EQ, 1601-C) for the print engine (C9,
   * D57). Same source of the taxpayer block as the seven returns (D12): the filing
   * snapshot once filed, the client's record while it is a draft; a form filed before
   * U3 has no snapshot and reads the live client, and the audit says so.
   */
  private async withholdingPrintSource(
    user: AuthUser,
    f: Awaited<ReturnType<BirFormsService["loadOwned"]>>,
  ) {
    this.assertSupported(f.form);
    const client = await this.clients.assertInFirm(user.firmId, f.clientId);
    let snapshot: FiledSnapshot | null;
    try {
      snapshot = readFiledSnapshot(f.filedSnapshotJson);
    } catch (err) {
      throw new InternalServerErrorException(`Form ${f.id}: ${(err as Error).message}`);
    }
    const tp = clientToTaxpayer(snapshot ? snapshotToClient(snapshot) : client);
    // U21/U22: refused unless 11 digits; the print carries the normalised 11 digits.
    let data = (f.dataJson ?? {}) as FilingData;
    if (!snapshot) {
      this.assertContact(f.form, f.dataJson, tp.phone);
      const plain = normalisedContact(contactNumberOf(f.form, data, tp.phone));
      tp.phone = plain;
      data = { ...data, contact: plain };
    }
    const snapshotAudit = snapshot
      ? { snapshot: "used", snapshotTakenAt: snapshot.takenAt }
      : { snapshot: f.status === "filed" ? "none (pre-U3)" : "none (draft)" };
    const form = f.form as WithholdingPrintForm;
    try {
      const rows = buildWithholdingPrintRows(form, data, tp, f.period);
      return {
        rows,
        baseName: withholdingPrintBaseName(form, f.period, tp),
        snapshotAudit,
      };
    } catch (err) {
      if (err instanceof ExportRefusal) throw new ConflictException(err.message);
      throw err;
    }
  }

  /**
   * The eBIRForms export of a loaded form, as exportForm and clearCopy both write
   * it (and previewPdf prints without storing). A return the export cannot carry
   * faithfully is refused with 409 (U13 F1).
   */
  private async buildExport(
    user: AuthUser,
    f: Awaited<ReturnType<BirFormsService["loadOwned"]>>,
    opts: { store: boolean } = { store: true },
  ) {
    this.assertSupported(f.form);
    // U17 R3: the withholding returns are printed; no eBIRForms key list is verified for them.
    if (WITHHOLDING_FORMS.has(f.form)) throw new ConflictException(PRINTED_NOT_XML);
    if (!XML_EXPORT_FORMS.has(f.form)) {
      throw new BadRequestException(
        `Form ${f.form} is a certificate issued to a payee, not an e-filed return — ` +
          "BIR defines no eBIRForms XML for it. Print it as a PDF from the form editor instead.",
      );
    }
    if (opts.store && !this.storage.isEnabled()) {
      throw new BadRequestException("File storage is not configured — cannot export.");
    }
    const client = await this.clients.assertInFirm(user.firmId, f.clientId);
    // D12: a form filed under U3 exports the taxpayer block it was filed with; a form
    // filed before U3 has no snapshot and reads the live client, and the audit says so.
    let snapshot: FiledSnapshot | null;
    try {
      snapshot = readFiledSnapshot(f.filedSnapshotJson);
    } catch (err) {
      throw new InternalServerErrorException(`Form ${f.id}: ${(err as Error).message}`);
    }
    const taxpayer = clientToTaxpayer(snapshot ? snapshotToClient(snapshot) : client);
    // U21/U22: a return does not leave the Portal without a contact number of 11 digits,
    // and the XML and the print carry those 11 digits. A filed return's sealed snapshot is
    // never refused and is answered as it was filed.
    if (!snapshot) {
      this.assertContact(f.form, f.dataJson, taxpayer.phone);
      taxpayer.phone = normalisedContact(taxpayer.phone);
    }
    const snapshotAudit = snapshot
      ? { snapshot: "used", snapshotTakenAt: snapshot.takenAt }
      : { snapshot: f.status === "filed" ? "none (pre-U3)" : "none (draft)" };
    // U13 F3: the 2550Q's filing date is a filed return's own (Manila), a draft's
    // export date. F4: its quarters follow the fiscal year start the return was
    // filed with (the snapshot's, from U13 on) or, for a draft, the client's. A
    // return filed before U13 keeps the calendar quarters it was filed with: a
    // filed document is never re-dated (D12).
    const fiscalYearStart =
      f.status === "filed"
        ? (snapshot?.fiscalYearStart ?? null)
        : client.fiscalYearStart
          ? client.fiscalYearStart.toISOString().slice(0, 10)
          : null;
    const options: Build2550QOptions = {
      dateFiled: manilaDate(f.status === "filed" && f.filedAt ? f.filedAt : new Date()),
      fiscalYearStart,
    };
    const data = (f.dataJson ?? {}) as unknown as FilingData;
    const filing = {
      id: f.id,
      form: f.form as FormCode,
      taxpayerId: f.clientId,
      status: f.status as "draft" | "filed",
      period: f.period,
      data,
      createdAt: 0,
      updatedAt: 0,
    };
    try {
      return { ...this.buildXml(filing, taxpayer, options), snapshotAudit };
    } catch (err) {
      if (err instanceof ExportRefusal) throw new ConflictException(err.message);
      throw err;
    }
  }

  /** A fresh signed download URL for a stored export. */
  async exportUrl(user: AuthUser, id: string, exportId: string) {
    await this.loadAuthorized(user, id, BIR_FORMS_PERMISSION.read);
    const exp = await this.prisma.birFormExport.findFirst({
      where: { id: exportId, birFormId: id },
    });
    if (!exp) throw new NotFoundException("Export not found");
    // U14 R5: a link that downloads, under the export's own name.
    return {
      url: await this.storage.signedGetUrl(exp.storageKey, { filename: exp.filename }),
    };
  }

  // --- U20 (D60): what the MCP connector needs of the BIR forms ----------------------------

  /** The client's draft and latest filed return for one form and period (caller authorized to read). */
  async findForPeriod(user: AuthUser, clientId: string, form: string, period: string) {
    await this.rbac.assertClient(user, [BIR_FORMS_PERMISSION.read], clientId);
    await this.clients.assertInFirm(user.firmId, clientId);
    const rows = await this.prisma.birForm.findMany({
      where: { firmId: user.firmId, clientId, form, period },
      orderBy: [{ sequence: "desc" }, { createdAt: "desc" }],
      select: { id: true, status: true, sequence: true },
    });
    return {
      draft: rows.find((r) => r.status === "draft") ?? null,
      filed: rows.find((r) => r.status === "filed") ?? null,
    };
  }

  /**
   * A short-lived signed link to the Preview PDF of a draft (the same print the web
   * shows, stamped DRAFT). The PDF is kept in storage under a preview key so the link
   * can be signed like an export's (1 hour); it is never the clear copy. The same
   * refusals as the Preview PDF.
   */
  async previewLink(user: AuthUser, id: string): Promise<{ url: string; filename: string }> {
    const { pdf, filename } = await this.previewPdf(user, id);
    if (!this.storage.isEnabled()) throw new ServiceUnavailableException(MESSAGES.noStorage);
    const key = this.storage.birFormExportKey(user.firmId, id, `preview-${randomUUID()}-DRAFT.pdf`);
    await this.storage.putObject(key, pdf, "application/pdf");
    return { url: await this.storage.signedGetUrl(key, { filename }), filename };
  }

  /** A short-lived signed link to the alphalist .DAT (made only when the check is ok). */
  async alphalistLink(user: AuthUser, id: string): Promise<{ url: string; fileName: string }> {
    const { text, fileName } = await this.alphalistFile(user, id);
    if (!this.storage.isEnabled()) throw new ServiceUnavailableException(MESSAGES.noStorage);
    const key = this.storage.birFormExportKey(user.firmId, id, `alphalist-${randomUUID()}-${fileName}`);
    await this.storage.putObject(key, Buffer.from(text, "ascii"), "text/plain");
    return { url: await this.storage.signedGetUrl(key, { filename: fileName }), fileName };
  }

  /** The alphalist check with the structured payee needs the connector turns into questions. */
  async alphalistOutcome(user: AuthUser, id: string) {
    return (await this.alphalistOf(user, id)).outcome;
  }

  // --- U19 (D59): the 1601-EQ alphalist (QAP .DAT) ----------------------------------------

  /** The alphalist file of a 1601-EQ, or 409 with the refusals (each names the payee and the field). */
  async alphalistFile(user: AuthUser, id: string): Promise<{ text: string; fileName: string }> {
    const { outcome } = await this.alphalistOf(user, id);
    if (!outcome.model) throw this.alphalistRefusal(outcome.check.refusals);
    return { text: writeQap(outcome.model), fileName: qapFileName(outcome.model) };
  }

  /** The check: ok, the rows and totals per schedule, and every refusal as a list. No file. */
  async alphalistCheck(user: AuthUser, id: string) {
    return (await this.alphalistOf(user, id)).outcome.check;
  }

  private async alphalistOf(user: AuthUser, id: string) {
    const f = await this.loadAuthorized(user, id, BIR_FORMS_PERMISSION.read);
    if (f.form !== "1601EQ") throw new ConflictException(ONLY_1601EQ);
    const client = await this.clients.assertInFirm(user.firmId, f.clientId);
    return { f, outcome: await this.alphalists.inspect(f, client) };
  }

  private alphalistRefusal(refusals: string[]): ConflictException {
    return new ConflictException({
      statusCode: 409,
      error: "Conflict",
      message: refusals[0],
      refusals,
    });
  }

  /** What the return shows of its alphalist: stored at filing or not, and why not. */
  private alphalistState(f: { status: string; filedSnapshotJson?: unknown }) {
    if (f.status !== "filed") return { stored: false, warning: null };
    const stored = readStoredAlphalist(f.filedSnapshotJson);
    if (stored.model) return { stored: true, warning: null };
    return {
      stored: false,
      warning: stored.refused.length > 0 ? { message: FILING_WARNING, refusals: stored.refused } : null,
    };
  }

  // --- U18 (D58): the BIR's confirmation e-mail -------------------------------------

  /**
   * Check an uploaded confirmation against a return, with no side effects: the nine
   * checks, in order, each ok, error or warning, and an overall ok. For the nine returns
   * that need one (CONFIRMATION_FORMS); the 1601-C, 2307 and 2316 answer 400.
   */
  async confirmationCheck(user: AuthUser, id: string, file: UploadedPdf | undefined) {
    const f = await this.loadForConfirmation(user, id);
    if (!file?.buffer) throw new BadRequestException(MESSAGES.noFile);
    const client = await this.clients.assertInFirm(user.firmId, f.clientId);
    return this.confirmations.assess(user.firmId, f, client, file.buffer);
  }

  /**
   * Mark a draft as filed with the BIR's confirmation (or a Super Admin's override). The
   * filed date becomes the date the BIR received the return; the PDF is kept; the filing
   * and the confirmation are written in one transaction. A confirmation that fails a
   * check is refused 409 with every check in the body and nothing written.
   */
  async markFiled(user: AuthUser, id: string, input: ConfirmationUpload) {
    const f = await this.loadForConfirmation(user, id);
    if (f.status === "filed") throw new ConflictException(MESSAGES.alreadyFiled);
    // U17: a 1601-EQ of more than six ATCs is never marked filed (nothing is dropped).
    const six = sixRowsRefusal(f.form, f.dataJson);
    if (six) throw new ConflictException(six);
    const client = await this.clients.assertInFirm(user.firmId, f.clientId);
    // U21: the contact number is checked before the confirmation is (the snapshot below is
    // taken from this client, and a return without one cannot be submitted).
    this.assertContact(f.form, f.dataJson, client.phone);
    const basis = await this.confirmationBasis(user, f, client, input);
    const filedAt = basis.kind === "bir_email" ? basis.receivedAt : new Date();
    const snapshot = takeFiledSnapshot(withPlainPhone(client), filedAt);
    // U19 (D59): a 1601-EQ is filed WITH its alphalist rows (a filed return is sealed, so
    // they cannot be made later). An incomplete alphalist does not block the filing: no
    // rows are stored and the refusals are kept, to be shown as a warning.
    const filedSnapshot: Record<string, unknown> = { ...snapshot };
    if (f.form === "1601EQ") {
      const made = await this.alphalists.inspect(f, client);
      filedSnapshot.alphalist = storedAlphalist(
        made.model ? { model: made.model } : { refused: made.check.refusals },
        filedAt,
      );
    }
    const key = await this.keepConfirmation(user.firmId, f.id, basis);
    try {
      await this.prisma.$transaction([
        this.prisma.birForm.update({
          where: { id },
          data: {
            status: "filed",
            filedAt,
            filedSnapshotJson: filedSnapshot as unknown as Prisma.InputJsonValue,
          },
        }),
        this.prisma.birFormConfirmation.create({
          data: this.confirmationRow(user, f, basis, key),
        }),
      ]);
    } catch (err) {
      await this.unkeep(key);
      throw this.confirmationWriteError(err, f.form);
    }
    await this.audit.record({
      userId: user.id,
      action: basis.kind === "override" ? "bir-form.confirmation.override" : "bir-form.mark-filed",
      entityType: "BirForm",
      entityId: id,
      metadata: this.confirmationAudit(f, basis, { filedAt: filedAt.toISOString() }),
    });
    return this.detail(await this.loadOwned(user.firmId, id));
  }

  /**
   * U22 (D63): take back a filing made WITHOUT the BIR confirmation e-mail (the Super
   * Admin's override). Only when the return is filed, its live confirmation is an override,
   * no BIR e-mail was ever attached to it and nothing amends it; every other case is 409.
   * The return goes back to a draft with its data as filed; the filed date, the snapshot
   * (with a 1601-EQ's stored alphalist) and the override row are kept as history. The seal
   * is opened for this one transition by the database function bir_form_undo_filing,
   * which checks the same conditions itself.
   */
  async undoFiling(user: AuthUser, id: string, input: { reason?: unknown }) {
    const f = await this.loadOwned(user.firmId, id);
    if (!(await this.confirmations.isSuperAdmin(user))) {
      throw new ForbiddenException(MESSAGES.undoSuperAdmin);
    }
    await this.rbac.assertClient(user, [BIR_FORMS_PERMISSION.file], f.clientId);
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason.length < MIN_REASON_LENGTH) throw new BadRequestException(MESSAGES.shortReason);
    const live = f.confirmations?.[0] ?? null;
    const everEmailed = await this.prisma.birFormConfirmation.count({
      where: { birFormId: f.id, kind: "bir_email" },
    });
    if (f.status !== "filed" || !live || live.kind !== "override" || everEmailed > 0) {
      throw new ConflictException(MESSAGES.undoNotAllowed);
    }
    const amendments = await this.prisma.birForm.count({ where: { amendsId: f.id } });
    if (amendments > 0) throw new ConflictException(MESSAGES.undoAmended);
    try {
      await this.prisma.$queryRaw`
        SELECT bir_form_undo_filing(${f.id}::uuid, ${user.firmId}::uuid, ${user.id}::uuid, ${reason})`;
    } catch (err) {
      // Someone changed the return between the reads above and the function's own checks.
      if (/BIR_UNDO_REFUSED/.test(String((err as Error)?.message))) {
        throw new ConflictException(MESSAGES.undoNotAllowed);
      }
      throw err;
    }
    await this.audit.record({
      userId: user.id,
      action: "bir-form.filing.undone",
      entityType: "BirForm",
      entityId: id,
      metadata: {
        reason,
        form: f.form,
        period: f.period,
        filedAt: f.filedAt ? f.filedAt.toISOString() : null,
        confirmationId: live.id,
        overrideReason: live.overrideReason ?? null,
      },
    });
    return this.detail(await this.loadOwned(user.firmId, id));
  }

  /**
   * Attach the confirmation (or an override) to a return that is ALREADY filed: the same
   * checks; the filed snapshot and the filed date are not touched. Once only — a second
   * attach answers 409; `replace` is for a Super Admin, and keeps the old row, marked
   * superseded, never deleted.
   */
  async attachConfirmation(user: AuthUser, id: string, input: ConfirmationUpload) {
    const f = await this.loadForConfirmation(user, id);
    if (f.status !== "filed") throw new ConflictException(MESSAGES.notFiledYet);
    const existing = f.confirmations?.[0] ?? null;
    if (existing && !input.replace) throw new ConflictException(MESSAGES.hasOne);
    if (existing && !(await this.confirmations.isSuperAdmin(user))) {
      throw new ForbiddenException(MESSAGES.replaceSuperAdmin);
    }
    const client = await this.clients.assertInFirm(user.firmId, f.clientId);
    const basis = await this.confirmationBasis(user, f, client, input);
    const key = await this.keepConfirmation(user.firmId, f.id, basis);
    try {
      await this.prisma.$transaction([
        ...(existing
          ? [
              this.prisma.birFormConfirmation.update({
                where: { id: existing.id },
                data: { supersededAt: new Date() },
              }),
            ]
          : []),
        this.prisma.birFormConfirmation.create({
          data: this.confirmationRow(user, f, basis, key),
        }),
      ]);
    } catch (err) {
      await this.unkeep(key);
      throw this.confirmationWriteError(err, f.form);
    }
    await this.audit.record({
      userId: user.id,
      action: existing
        ? "bir-form.confirmation.replace"
        : basis.kind === "override"
          ? "bir-form.confirmation.override"
          : "bir-form.confirmation.attach",
      entityType: "BirForm",
      entityId: id,
      metadata: this.confirmationAudit(f, basis, existing ? { replaced: existing.id } : {}),
    });
    return this.detail(await this.loadOwned(user.firmId, id));
  }

  /** A signed link to the kept PDF (404 if the return has none, or only an override). */
  async confirmationUrl(user: AuthUser, id: string) {
    const f = await this.loadAuthorized(user, id, BIR_FORMS_PERMISSION.read);
    const row = f.confirmations?.[0];
    const url = row ? await this.confirmations.downloadUrl(row) : null;
    if (!url) throw new NotFoundException(MESSAGES.noFileKept);
    return { url };
  }

  /** The return, for an action on its confirmation: BIRForms:File, and one of the nine forms. */
  private async loadForConfirmation(user: AuthUser, id: string) {
    const f = await this.loadAuthorized(user, id, BIR_FORMS_PERMISSION.file);
    if (!CONFIRMATION_FORMS.has(f.form)) {
      throw new BadRequestException(MESSAGES.nothingToUpload(f.form));
    }
    return f;
  }

  /** What the filing rests on: a confirmation that passed every check, or a Super Admin's override. */
  private async confirmationBasis(
    user: AuthUser,
    f: { form: string; period: string },
    client: Parameters<ConfirmationService["assess"]>[2],
    input: ConfirmationUpload,
  ): Promise<ConfirmationBasis> {
    if (input.overrideReason !== undefined) {
      if (input.file) throw new BadRequestException(MESSAGES.bothGiven);
      if (!(await this.confirmations.isSuperAdmin(user))) {
        throw new ForbiddenException(MESSAGES.overrideSuperAdmin);
      }
      const reason = input.overrideReason.trim();
      if (reason.length < MIN_REASON_LENGTH) throw new BadRequestException(MESSAGES.shortReason);
      return { kind: "override", reason };
    }
    if (!input.file?.buffer) throw new BadRequestException(MESSAGES.noFile);
    const result = await this.confirmations.assess(user.firmId, f, client, input.file.buffer);
    if (!result.ok) {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        message: result.errors[0],
        ...result,
      });
    }
    return {
      kind: "bir_email",
      bytes: input.file.buffer,
      originalname: uploadedFileName(input.file.originalname ?? ""),
      result,
      receivedAt: new Date(result.parsed!.receivedAt!),
    };
  }

  /** Put the PDF in storage before the transaction (an override has none); null for an override. */
  private async keepConfirmation(
    firmId: string,
    birFormId: string,
    basis: ConfirmationBasis,
  ): Promise<string | null> {
    if (basis.kind === "override") return null;
    if (!this.storage.isEnabled()) throw new ServiceUnavailableException(MESSAGES.noStorage);
    return this.confirmations.store(firmId, birFormId, basis.bytes);
  }

  private async unkeep(key: string | null): Promise<void> {
    if (key) await this.confirmations.removeStored(key);
  }

  private confirmationRow(
    user: AuthUser,
    f: { id: string; firmId: string },
    basis: ConfirmationBasis,
    key: string | null,
  ): Prisma.BirFormConfirmationUncheckedCreateInput {
    const base = { firmId: f.firmId, birFormId: f.id, uploadedByUserId: user.id };
    if (basis.kind === "override") {
      return { ...base, kind: "override", overrideReason: basis.reason, warnings: [] };
    }
    const p = basis.result.parsed!;
    return {
      ...base,
      kind: "bir_email",
      storageKey: key,
      originalFilename: basis.originalname.slice(0, 255) || null,
      sha256: basis.result.sha256,
      birFileName: p.birFileName,
      tinWithBranch: `${p.tin}-${String(Number(p.branch)).padStart(5, "0")}`,
      formCode: p.form,
      taxYear: p.taxYear,
      quarter: p.quarter,
      fyEndMonth: p.fyEndMonth,
      receivedAt: basis.receivedAt,
      warnings: basis.result.warnings,
    };
  }

  /** Audit metadata: what was kept, never the e-mail's text, its recipient or its address. */
  private confirmationAudit(
    f: { form: string; period: string },
    basis: ConfirmationBasis,
    extra: Record<string, unknown>,
  ) {
    return basis.kind === "override"
      ? { form: f.form, period: f.period, kind: "override", reason: basis.reason, ...extra }
      : {
          form: f.form,
          period: f.period,
          kind: "bir_email",
          birFileName: basis.result.parsed!.birFileName,
          receivedAt: basis.receivedAt.toISOString(),
          sha256: basis.result.sha256,
          warnings: basis.result.warnings.length,
          ...extra,
        };
  }

  /** A write that lost a race: the seal (someone filed it first) or a duplicate confirmation. */
  private confirmationWriteError(err: unknown, form: string): Error {
    if (isSealError(err)) return new ConflictException(sealedMessage(form));
    if ((err as { code?: unknown })?.code === "P2002") {
      return new ConflictException(MESSAGES.duplicate("another return"));
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  // --- internals -------------------------------------------------------------

  /** U17 R2: the withholding returns take a calendar month or quarter, and only theirs. */
  /** U21: refuse a return with no contact number (or one the paper cannot carry), in words. */
  private assertContact(
    form: string,
    data: unknown,
    clientPhone: string | null | undefined,
  ): void {
    if (!CONTACT_FORMS.has(form)) return;
    const sentence = contactRefusal(
      form,
      contactNumberOf(form, data as Record<string, unknown> | null, clientPhone),
    );
    if (sentence) throw new ConflictException(sentence);
  }

  private assertWithholdingPeriod(form: string, period: string): void {
    const refusal = checkWithholdingPeriod(form, period);
    if (refusal) throw new BadRequestException(refusal);
  }

  private assertSupported(form: string): void {
    if (!AVAILABLE_FORMS.has(form)) {
      throw new BadRequestException(`Form ${form} is not available yet.`);
    }
  }

  /** Dispatch to the ported compute engine. */
  private compute(form: string, data: FilingData) {
    if (form === "2551Q") return compute2551Q(data);
    if (form === "2550Q") return compute2550Q(data);
    if (form === "1701Q") return compute1701Q(data);
    if (form === "1701A") return compute1701A(data);
    if (form === "1701") return compute1701(data);
    if (form === "1702Q") return compute1702Q(data);
    if (form === "1702RT") return compute1702RT(data);
    if (form === "2307") return compute2307(data);
    if (form === "2316") return compute2316(data);
    if (form === "0619E") return compute0619E(data);
    if (form === "1601EQ") return compute1601EQ(data);
    if (form === "1601C") return compute1601C(data);
    throw new BadRequestException(`Form ${form} is not available yet.`);
  }

  /** Build the eBIRForms XML + canonical filename for a saved form. */
  private buildXml(
    filing: Filing,
    taxpayer: Taxpayer,
    options: Build2550QOptions = {},
  ): { xml: string; filename: string } {
    const data = filing.data ?? {};
    if (filing.form === "2551Q") {
      const comp = compute2551Q(data);
      return {
        xml: build2551Q(filing, taxpayer, comp),
        filename: fileName2551Q(filing, taxpayer),
      };
    }
    if (filing.form === "2550Q") {
      const comp = compute2550Q(data);
      return {
        xml: build2550Q(filing, taxpayer, comp, options),
        filename: fileName2550Q(filing, taxpayer, options),
      };
    }
    if (filing.form === "1701Q") {
      const comp = compute1701Q(data);
      return {
        xml: build1701Q(filing, taxpayer, comp),
        filename: fileName1701Q(filing, taxpayer),
      };
    }
    if (filing.form === "1701A") {
      const comp = compute1701A(data);
      return {
        xml: build1701A(filing, taxpayer, comp),
        filename: fileName1701A(filing, taxpayer),
      };
    }
    if (filing.form === "1701") {
      const comp = compute1701(data);
      return {
        xml: build1701(filing, taxpayer, comp),
        filename: fileName1701(filing, taxpayer),
      };
    }
    if (filing.form === "1702Q") {
      const comp = compute1702Q(data);
      return {
        xml: build1702Q(filing, taxpayer, comp),
        filename: fileName1702Q(filing, taxpayer),
      };
    }
    if (filing.form === "1702RT") {
      const comp = compute1702RT(data);
      return {
        xml: build1702RT(filing, taxpayer, comp),
        filename: fileName1702RT(filing, taxpayer),
      };
    }
    throw new BadRequestException(`Form ${filing.form} is not available yet.`);
  }

  /**
   * The handful of authoritative figures the client tax view surfaces for a
   * filed form. Kept deliberately small — the full compute lives in getOne.
   * Returns null for forms without a ported engine.
   */
  private keyFigures(
    form: string,
    data: FilingData,
  ): { totalTaxDue: number; totalPayable: number } | null {
    if (form === "2551Q") {
      const c = compute2551Q(data);
      return { totalTaxDue: c.i14, totalPayable: c.i24 };
    }
    if (form === "2550Q") {
      const c = compute2550Q(data);
      // i34b = total output tax due; i26 = total amount payable.
      return { totalTaxDue: c.i34b, totalPayable: c.i26 };
    }
    if (form === "1701Q") {
      const c = compute1701Q(data);
      // Sum both columns (filer + spouse); aggregate is the total payable.
      return { totalTaxDue: c.A.taxDue + c.B.taxDue, totalPayable: c.aggregate };
    }
    if (form === "1701A") {
      const c = compute1701A(data);
      // i30 is the aggregate amount payable across both columns.
      return { totalTaxDue: c.A.taxDue + c.B.taxDue, totalPayable: c.i30 };
    }
    if (form === "1701") {
      const c = compute1701(data);
      return { totalTaxDue: c.A.taxDue + c.B.taxDue, totalPayable: c.aggregate };
    }
    if (form === "1702Q") {
      const c = compute1702Q(data);
      // i18 = aggregate income tax due; i25 = total amount payable.
      return { totalTaxDue: c.i18, totalPayable: c.i25 };
    }
    if (form === "1702RT") {
      const c = compute1702RT(data);
      // i43 = tax due (higher of normal vs MCIT); i21 = total amount payable.
      return { totalTaxDue: c.i43, totalPayable: c.i21 };
    }
    return null;
  }

  /**
   * U4 R2: the clientId filter of a list. A named client must be one the caller is
   * authorized for (else 403); with none named, the clients the caller may see.
   */
  private async clientScope(
    user: AuthUser,
    clientId?: string,
  ): Promise<Prisma.BirFormWhereInput> {
    if (clientId) {
      await this.rbac.assertClient(user, [BIR_FORMS_PERMISSION.read], clientId);
      return { clientId };
    }
    const clients = await this.rbac.authorizedClients(user, [BIR_FORMS_PERMISSION.read]);
    return clients === "all" ? {} : { clientId: { in: [...clients] } };
  }

  /**
   * A form of the caller's firm (404 otherwise) that the caller may act on with
   * `permission` for its client (403 otherwise, in the guard's words — U4 R2).
   */
  private async loadAuthorized(user: AuthUser, id: string, permission: string) {
    const f = await this.loadOwned(user.firmId, id);
    await this.rbac.assertClient(user, [permission], f.clientId);
    return f;
  }

  private async loadOwned(firmId: string, id: string) {
    const f = await this.prisma.birForm.findFirst({
      where: { id, firmId },
      include: {
        client: { select: { businessName: true } },
        exports: true,
        // U18: the live confirmation (a replaced one is kept, but not shown here)
        confirmations: { where: { supersededAt: null } },
        // U22 (D63): the filings taken back, oldest first
        filingUndos: { orderBy: { undoneAt: "asc" } },
      },
    });
    if (!f) throw new NotFoundException("Form not found");
    return f;
  }

  private toSummary(f: {
    id: string;
    clientId: string;
    client?: { businessName: string } | null;
    form: string;
    status: string;
    period: string;
    filedAt?: Date | null;
    sequence?: number;
    amendsId?: string | null;
    filedSnapshotJson?: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: f.id,
      clientId: f.clientId,
      clientName: f.client?.businessName ?? "",
      form: f.form,
      status: f.status,
      period: f.period,
      filedAt: f.filedAt ? f.filedAt.toISOString() : null,
      // U3 (R6), additive: the amendment chain and the filing snapshot.
      sequence: f.sequence ?? 1,
      amendsId: f.amendsId ?? null,
      filedSnapshot: f.filedSnapshotJson ?? null,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    };
  }
}
