import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { ClientsService } from "../clients/clients.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { BIR_FORM_CATALOG } from "./bir-forms.constants";
import { clientToTaxpayer } from "./client-mapping";
import {
  build2551Q,
  compute2551Q,
  fileName2551Q,
  type FilingData,
  type FormCode,
} from "./engine";
import type { CreateBirFormInput, UpdateBirFormInput } from "./dto/bir-form.schemas";

/** Forms whose compute + XML have been ported and are usable end-to-end. */
export const AVAILABLE_FORMS = new Set(["2551Q"]);

/**
 * Internal BIR Forms module (ported from the Sentire generator). Authoring +
 * authoritative compute + eBIRForms XML export. Every operation is firm-scoped;
 * the target client must belong to the actor's firm.
 */
@Injectable()
export class BirFormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** The BIR form catalog + per-form rollout status. */
  catalog() {
    return BIR_FORM_CATALOG;
  }

  /** Saved BIR forms for the actor's firm, optionally narrowed by client/status. */
  async list(user: AuthUser, clientId?: string, status?: string) {
    const where: Prisma.BirFormWhereInput = {
      firmId: user.firmId,
      ...(clientId ? { clientId } : {}),
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
      where: { firmId: user.firmId, status: "filed", ...(clientId ? { clientId } : {}) },
      orderBy: { filedAt: "desc" },
      include: { client: { select: { businessName: true } } },
    });
    return rows.map((f) => ({
      ...this.toSummary(f),
      figures: this.keyFigures(f.form, (f.dataJson ?? {}) as unknown as FilingData),
    }));
  }

  async create(user: AuthUser, input: CreateBirFormInput) {
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
    return this.getOne(user, created.id);
  }

  /** One form with its raw data, computed figures, and export list. */
  async getOne(user: AuthUser, id: string) {
    const f = await this.loadOwned(user.firmId, id);
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
    await this.loadOwned(user.firmId, id);
    await this.prisma.birForm.update({
      where: { id },
      data: {
        ...(input.period !== undefined ? { period: input.period } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        // Filing lifecycle: stamp filedAt when a form is marked filed, clear it
        // when it's reopened to draft. This is what the client tax view keys on.
        ...(input.status === "filed"
          ? { filedAt: new Date() }
          : input.status === "draft"
            ? { filedAt: null }
            : {}),
        ...(input.data !== undefined ? { dataJson: input.data as Prisma.InputJsonValue } : {}),
      },
    });
    await this.audit.record({
      userId: user.id,
      action: "bir-form.update",
      entityType: "BirForm",
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });
    return this.getOne(user, id);
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
    const f = await this.loadOwned(user.firmId, id);
    this.assertSupported(f.form);
    if (!this.storage.isEnabled()) {
      throw new BadRequestException("File storage is not configured — cannot export.");
    }
    const client = await this.clients.assertInFirm(user.firmId, f.clientId);
    const taxpayer = clientToTaxpayer(client);
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
    const comp = compute2551Q(data);
    const xml = build2551Q(filing, taxpayer, comp);
    const filename = fileName2551Q(filing, taxpayer);

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
      metadata: { kind: "xml", filename },
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
    await this.loadOwned(user.firmId, id);
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

  /** Dispatch to the ported compute engine (2551Q today). */
  private compute(form: string, data: FilingData) {
    if (form === "2551Q") return compute2551Q(data);
    throw new BadRequestException(`Form ${form} is not available yet.`);
  }

  /**
   * The handful of authoritative figures the client tax view surfaces for a
   * filed form. Kept deliberately small — the full compute lives in getOne.
   * Returns null for forms without a ported engine.
   */
  private keyFigures(form: string, data: FilingData): { totalTaxDue: number; totalPayable: number } | null {
    if (form === "2551Q") {
      const c = compute2551Q(data);
      return { totalTaxDue: c.i14, totalPayable: c.i24 };
    }
    return null;
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
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    };
  }
}
