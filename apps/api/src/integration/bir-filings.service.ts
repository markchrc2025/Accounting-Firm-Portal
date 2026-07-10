import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  BirFilingPushback,
  InputTaxAssetHandoff,
} from "@portal/shared";
import type { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Receives the Generator's push-back (guardrail #1: the Portal only RECORDS the
 * filed artifact + Input Tax Asset; it never computes authoritative BIR tax).
 * Writes are idempotent, keyed by client + form + period (guardrail #4).
 */
@Injectable()
export class BirFilingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async assertClientInFirm(firmId: string, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, firmId },
      select: { id: true },
    });
    if (!client) throw new NotFoundException("Client not found");
  }

  /** Create or update (idempotent) the BIR filing for client + form + period. */
  async upsertFiling(
    integrationClientId: string,
    firmId: string,
    clientId: string,
    payload: BirFilingPushback,
  ) {
    await this.assertClientInFirm(firmId, clientId);
    const key = {
      clientId_form_periodStart_periodEnd: {
        clientId,
        form: payload.form,
        periodStart: new Date(payload.periodStart),
        periodEnd: new Date(payload.periodEnd),
      },
    };
    const data = {
      periodType: payload.periodType,
      status: payload.status,
      figuresJson: payload.figures as Prisma.InputJsonValue,
      xmlFilename: payload.xmlFilename,
      xmlBase64: payload.xmlBase64,
      pdfUrl: payload.pdfUrl ?? null,
    };
    const filing = await this.prisma.bIRFiling.upsert({
      where: key,
      create: {
        clientId,
        form: payload.form,
        periodStart: new Date(payload.periodStart),
        periodEnd: new Date(payload.periodEnd),
        ...data,
      },
      update: data,
    });
    await this.audit.record({
      action: "integration.bir-filing.upsert",
      entityType: "BIRFiling",
      entityId: filing.id,
      metadata: { integrationClientId, form: payload.form, status: payload.status },
    });
    return { ref: filing.id, status: filing.status };
  }

  /** Re-sync a specific filing by reference (PUT /bir-filings/{ref}). */
  async updateFiling(
    integrationClientId: string,
    firmId: string,
    clientId: string,
    ref: string,
    payload: BirFilingPushback,
  ) {
    await this.assertClientInFirm(firmId, clientId);
    const existing = await this.prisma.bIRFiling.findFirst({
      where: { id: ref, clientId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Filing not found");
    const filing = await this.prisma.bIRFiling.update({
      where: { id: ref },
      data: {
        form: payload.form,
        periodType: payload.periodType,
        periodStart: new Date(payload.periodStart),
        periodEnd: new Date(payload.periodEnd),
        status: payload.status,
        figuresJson: payload.figures as Prisma.InputJsonValue,
        xmlFilename: payload.xmlFilename,
        xmlBase64: payload.xmlBase64,
        pdfUrl: payload.pdfUrl ?? null,
      },
    });
    await this.audit.record({
      action: "integration.bir-filing.update",
      entityType: "BIRFiling",
      entityId: filing.id,
      metadata: { integrationClientId, form: payload.form, status: payload.status },
    });
    return { ref: filing.id, status: filing.status };
  }

  /** List stored filings for reconciliation (metadata only — no XML payload). */
  async listFilings(firmId: string, clientId: string) {
    await this.assertClientInFirm(firmId, clientId);
    return this.prisma.bIRFiling.findMany({
      where: { clientId },
      select: {
        id: true,
        form: true,
        periodType: true,
        periodStart: true,
        periodEnd: true,
        status: true,
        xmlFilename: true,
        pdfUrl: true,
        updatedAt: true,
      },
      orderBy: [{ periodStart: "desc" }],
    });
  }

  /** Book the carried-forward Input Tax Asset (idempotent by client+form+period). */
  async bookInputTaxAsset(
    integrationClientId: string,
    firmId: string,
    clientId: string,
    payload: InputTaxAssetHandoff,
  ) {
    await this.assertClientInFirm(firmId, clientId);
    const data = {
      excessInputTaxCarriedForward: payload.excessInputTaxCarriedForward,
      deferredCapitalGoodsInputTax: payload.deferredCapitalGoodsInputTax,
      totalInputTaxAsset: payload.totalInputTaxAsset,
      computedAt: new Date(payload.computedAt),
    };
    const asset = await this.prisma.inputTaxAsset.upsert({
      where: {
        clientId_sourceForm_asOfYear_asOfQuarter: {
          clientId,
          sourceForm: payload.sourceForm,
          asOfYear: payload.asOfPeriod.year,
          asOfQuarter: payload.asOfPeriod.quarter,
        },
      },
      create: {
        clientId,
        sourceForm: payload.sourceForm,
        asOfYear: payload.asOfPeriod.year,
        asOfQuarter: payload.asOfPeriod.quarter,
        ...data,
      },
      update: data,
    });
    await this.audit.record({
      action: "integration.input-tax-asset.book",
      entityType: "InputTaxAsset",
      entityId: asset.id,
      metadata: {
        integrationClientId,
        sourceForm: payload.sourceForm,
        total: payload.totalInputTaxAsset,
      },
    });
    return { ref: asset.id, totalInputTaxAsset: payload.totalInputTaxAsset };
  }
}
