// confirmation.service.ts — U18 (D58): the database and storage side of the BIR
// confirmation: the duplicate lookup for check 7, who is a Super Admin, the stored PDF,
// and the shape the API shows. The orchestration (the transaction that files a return
// with its confirmation) is BirFormsService's, which owns the seal and the snapshot.
import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { BirFormConfirmation, Client } from "@prisma/client";
import type { AuthUser } from "../common/auth/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { SUPER_ADMIN_ROLE } from "../rbac/permissions.constants";
import { StorageService } from "../storage/storage.service";
import {
  evaluateConfirmation,
  type ConfirmationResult,
  type DuplicateHit,
  type DuplicateQuery,
  type ExpectedReturn,
} from "./confirmation-checks";

/** What the API shows of a kept confirmation (never the e-mail's own text). */
export interface ConfirmationSummary {
  id: string;
  kind: "bir_email" | "override";
  birFileName: string | null;
  receivedAt: string | null;
  /** The Manila date the BIR received the return: the filed date for a confirmed return. */
  filedOn: string | null;
  originalFilename: string | null;
  hasFile: boolean;
  warnings: string[];
  overrideReason: string | null;
  /** True for an override: the return is shown as "Filed without BIR confirmation". */
  filedWithoutConfirmation: boolean;
  uploadedByUserId: string | null;
  uploadedAt: string;
}

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** The Manila calendar date of an instant, "2026-04-25". */
export function manilaDateOf(at: Date): string {
  return new Date(at.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** multer hands over the file name as latin1; a browser sends UTF-8. */
export function uploadedFileName(raw: string): string {
  const utf8 = Buffer.from(raw, "latin1").toString("utf8");
  return utf8.includes("�") ? raw : utf8;
}

@Injectable()
export class ConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** What a return and its client say the confirmation has to be. */
  expectedFor(
    f: { form: string; period: string },
    client: Pick<Client, "tin" | "branch" | "fiscalYearStart">,
  ): ExpectedReturn {
    const start = client.fiscalYearStart
      ? client.fiscalYearStart.toISOString().slice(0, 10)
      : null;
    const startMonth = start ? Number(start.slice(5, 7)) : 1;
    // A fiscal year starting in month 2–12 ends the month before; January (or none) is a calendar year.
    const fyEndMonth = startMonth >= 2 && startMonth <= 12 ? startMonth - 1 : 12;
    return {
      form: f.form,
      period: f.period,
      clientTin: client.tin,
      clientBranch: client.branch,
      fyEndMonth,
      fiscalYearStart: startMonth >= 2 ? start : null,
    };
  }

  /** Run all nine checks over an upload for a return. No side effects. */
  assess(
    firmId: string,
    f: { form: string; period: string },
    client: Pick<Client, "tin" | "branch" | "fiscalYearStart">,
    bytes: Uint8Array,
  ): Promise<ConfirmationResult> {
    return evaluateConfirmation({
      bytes,
      expected: this.expectedFor(f, client),
      now: new Date(),
      findDuplicate: (q) => this.findDuplicate(firmId, q),
    });
  }

  /** Check 7: a confirmation (live or replaced) with this file name and time, or these bytes. */
  private async findDuplicate(
    firmId: string,
    q: DuplicateQuery,
  ): Promise<DuplicateHit | null> {
    const or: Array<Record<string, unknown>> = [{ sha256: q.sha256 }];
    if (q.birFileName && q.receivedAt)
      or.push({ birFileName: q.birFileName, receivedAt: q.receivedAt });
    const row = await this.prisma.birFormConfirmation.findFirst({
      where: { firmId, kind: "bir_email", OR: or },
      orderBy: { uploadedAt: "asc" },
      select: {
        birForm: {
          select: {
            form: true,
            period: true,
            client: { select: { businessName: true } },
          },
        },
      },
    });
    return row
      ? {
          form: row.birForm.form,
          period: row.birForm.period,
          clientName: row.birForm.client.businessName,
        }
      : null;
  }

  /** A Super Admin of the firm (the role held firm-wide, as the connector's actor is). */
  async isSuperAdmin(user: AuthUser): Promise<boolean> {
    const n = await this.prisma.user.count({
      where: {
        id: user.id,
        firmId: user.firmId,
        status: "ACTIVE",
        userRoles: {
          some: { clientScopeId: null, role: { name: SUPER_ADMIN_ROLE, scope: "FIRM" } },
        },
      },
    });
    return n > 0;
  }

  /** Keep the PDF in object storage; returns its key. */
  async store(firmId: string, birFormId: string, bytes: Uint8Array): Promise<string> {
    const key = this.storage.birFormExportKey(
      firmId,
      birFormId,
      `confirmation-${randomUUID()}.pdf`,
    );
    await this.storage.putObject(key, bytes, "application/pdf");
    return key;
  }

  async removeStored(key: string): Promise<void> {
    await this.storage.deleteObject(key).catch(() => undefined);
  }

  summary(row: BirFormConfirmation): ConfirmationSummary {
    const warnings = Array.isArray(row.warnings)
      ? (row.warnings as unknown[]).map(String)
      : [];
    return {
      id: row.id,
      kind: row.kind as "bir_email" | "override",
      birFileName: row.birFileName,
      receivedAt: row.receivedAt ? row.receivedAt.toISOString() : null,
      filedOn: row.receivedAt ? manilaDateOf(row.receivedAt) : null,
      originalFilename: row.originalFilename,
      hasFile: row.storageKey !== null,
      warnings,
      overrideReason: row.overrideReason,
      filedWithoutConfirmation: row.kind === "override",
      uploadedByUserId: row.uploadedByUserId,
      uploadedAt: row.uploadedAt.toISOString(),
    };
  }

  /** A link that downloads the kept PDF, under a name of its own. */
  async downloadUrl(row: BirFormConfirmation): Promise<string | null> {
    if (!row.storageKey) return null;
    const base = (row.birFileName ?? "confirmation").replace(/\.xml$/i, "");
    return this.storage.signedGetUrl(row.storageKey, {
      filename: `${base}-BIR-confirmation.pdf`,
    });
  }
}
