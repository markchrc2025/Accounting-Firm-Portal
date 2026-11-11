// deadlines.service.ts — PA8 (D70): GET /bir/deadlines. Reads the firm's ACTIVE clients that the
// caller may see (BIRForms:Read, per client) and the returns they have on file, and hands them to the
// pure computeDeadlines. Nothing is written.
import { BadRequestException, Injectable } from "@nestjs/common";
import type { AuthUser } from "../../common/auth/auth-user";
import { PrismaService } from "../../prisma/prisma.service";
import { RbacService } from "../../rbac/rbac.service";
import { manilaToday } from "../../projects/projects.constants";
import { BIR_FORMS_PERMISSION } from "../bir-forms.service";
import { computeDeadlines, type ReturnRecord } from "./deadlines.compute";
import { RETURN_FORMS } from "./due-rules";
import type { DeadlineClient } from "./eligibility";

export const BAD_MONTHS = "from and to must be months written YYYY-MM.";
export const FROM_AFTER_TO = "from cannot be after to.";
export const RANGE_TOO_LONG = "The range can be at most 24 months.";
const MAX_MONTHS = 24;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

const index = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;

/** The range, or the sentence that refuses it. */
export function checkRange(from: unknown, to: unknown): { from: string; to: string } {
  const ok = (v: unknown): v is string =>
    typeof v === "string" &&
    MONTH.test(v) &&
    Number(v.slice(0, 4)) >= 2000 &&
    Number(v.slice(0, 4)) <= 2100;
  if (!ok(from) || !ok(to)) throw new BadRequestException(BAD_MONTHS);
  if (index(from) > index(to)) throw new BadRequestException(FROM_AFTER_TO);
  if (index(to) - index(from) + 1 > MAX_MONTHS)
    throw new BadRequestException(RANGE_TOO_LONG);
  return { from, to };
}

@Injectable()
export class BirDeadlinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  async deadlines(user: AuthUser, fromQ: unknown, toQ: unknown) {
    const { from, to } = checkRange(fromQ, toQ);
    const scope = await this.rbac.authorizedClients(user, [BIR_FORMS_PERMISSION.read]);
    const rows = await this.prisma.client.findMany({
      where: {
        firmId: user.firmId,
        status: "ACTIVE",
        ...(scope === "all" ? {} : { id: { in: [...scope] } }),
      },
      select: {
        id: true,
        businessName: true,
        kind: true,
        taxType: true,
        taxTypesJson: true,
        fiscalYearStart: true,
      },
    });
    const clients: DeadlineClient[] = rows.map((c) => ({
      id: c.id,
      name: c.businessName,
      kind: c.kind,
      taxType: c.taxType,
      taxTypesJson: c.taxTypesJson,
      fiscalYearStart: c.fiscalYearStart
        ? c.fiscalYearStart.toISOString().slice(0, 10)
        : null,
    }));

    const fromYear = Number(from.slice(0, 4)) - 2;
    const toYear = Number(to.slice(0, 4)) + 1;
    const forms = clients.length
      ? await this.prisma.birForm.findMany({
          where: {
            firmId: user.firmId,
            clientId: { in: clients.map((c) => c.id) },
            form: { in: [...RETURN_FORMS] },
          },
          select: {
            id: true,
            clientId: true,
            form: true,
            period: true,
            status: true,
            sequence: true,
            createdAt: true,
            confirmations: {
              where: { supersededAt: null },
              orderBy: { uploadedAt: "desc" },
              take: 1,
              select: { kind: true },
            },
          },
        })
      : [];
    const returns: ReturnRecord[] = forms
      .filter((f) => {
        const y = Number(f.period.slice(0, 4));
        return y >= fromYear && y <= toYear;
      })
      .map((f) => ({
        id: f.id,
        clientId: f.clientId,
        form: f.form,
        period: f.period,
        status: f.status === "filed" ? "filed" : "draft",
        sequence: f.sequence,
        createdAt: f.createdAt.toISOString(),
        confirmation:
          f.confirmations[0]?.kind === "bir_email"
            ? "bir_email"
            : f.confirmations[0]?.kind === "override"
              ? "override"
              : null,
      }));

    return computeDeadlines({ clients, returns, from, to, today: manilaToday() });
  }
}
