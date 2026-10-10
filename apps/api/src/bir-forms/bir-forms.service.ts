import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { ClientsService } from "../clients/clients.service";
import { PrismaService } from "../prisma/prisma.service";
import { RbacService } from "../rbac/rbac.service";
import { StorageService } from "../storage/storage.service";
import { BIR_FORM_CATALOG } from "./bir-forms.constants";
import { clientToTaxpayer } from "./client-mapping";
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
  compute1701,
  compute1701A,
  compute1701Q,
  compute1702Q,
  compute1702RT,
  compute2307,
  compute2316,
  compute2550Q,
  compute2551Q,
  fileName1701,
  fileName1701A,
  fileName1701Q,
  fileName1702Q,
  fileName1702RT,
  fileName2550Q,
  fileName2551Q,
  type Filing,
  type FilingData,
  type FormCode,
  type Taxpayer,
} from "./engine";
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

/** The seven returns: a filed one is corrected by an amendment (U3 R2, D11). */
export const RETURN_FORMS = XML_EXPORT_FORMS;

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
    return rows.map((f) => this.toSummary(f));
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
    return this.detail(await this.loadAuthorized(user, id, BIR_FORMS_PERMISSION.read));
  }

  /** The detail view of a loaded form (no authorization: callers have done it). */
  private detail(f: Awaited<ReturnType<BirFormsService["loadOwned"]>>) {
    const data = (f.dataJson ?? {}) as unknown as FilingData;
    return {
      ...this.toSummary(f),
      data,
      computed: AVAILABLE_FORMS.has(f.form) ? this.compute(f.form, data) : null,
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
    // An amendment corrects one filed return: it keeps that return's period (R2).
    if (f.amendsId && input.period !== undefined && input.period !== f.period) {
      throw new BadRequestException(
        `This draft amends the ${f.form} for ${f.period} and keeps that period. ` +
          "To correct a different period, amend that period's filed return.",
      );
    }

    // The draft → filed write carries filedAt and the taxpayer snapshot together (D12).
    const filedAt = input.status === "filed" ? new Date() : null;
    const snapshot = filedAt
      ? takeFiledSnapshot(
          await this.clients.assertInFirm(user.firmId, f.clientId),
          filedAt,
        )
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
    this.assertSupported(f.form);
    if (!XML_EXPORT_FORMS.has(f.form)) {
      throw new BadRequestException(
        `Form ${f.form} is a certificate issued to a payee, not an e-filed return — ` +
          "BIR defines no eBIRForms XML for it. Print it as a PDF from the form editor instead.",
      );
    }
    if (!this.storage.isEnabled()) {
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
    const snapshotAudit = snapshot
      ? { snapshot: "used", snapshotTakenAt: snapshot.takenAt }
      : { snapshot: f.status === "filed" ? "none (pre-U3)" : "none (draft)" };
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
    const { xml, filename } = this.buildXml(filing, taxpayer);

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
      url: await this.storage.signedGetUrl(key),
    };
  }

  /** A fresh signed download URL for a stored export. */
  async exportUrl(user: AuthUser, id: string, exportId: string) {
    await this.loadAuthorized(user, id, BIR_FORMS_PERMISSION.read);
    const exp = await this.prisma.birFormExport.findFirst({
      where: { id: exportId, birFormId: id },
    });
    if (!exp) throw new NotFoundException("Export not found");
    return { url: await this.storage.signedGetUrl(exp.storageKey) };
  }

  // --- internals -------------------------------------------------------------

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
    throw new BadRequestException(`Form ${form} is not available yet.`);
  }

  /** Build the eBIRForms XML + canonical filename for a saved form. */
  private buildXml(
    filing: Filing,
    taxpayer: Taxpayer,
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
        xml: build2550Q(filing, taxpayer, comp),
        filename: fileName2550Q(filing, taxpayer),
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
      include: { client: { select: { businessName: true } }, exports: true },
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
