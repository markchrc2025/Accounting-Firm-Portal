import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../common/auth/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { BIR_FORM_CATALOG } from "./bir-forms.constants";

/**
 * Internal BIR Forms module (ported from the Sentire BIR Form Generator).
 * Phase 0: the read surface — the form catalog and the firm's saved forms.
 * Compute / XML / PDF and the authoring flow land in later phases.
 */
@Injectable()
export class BirFormsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The BIR form catalog + per-form rollout status. */
  catalog() {
    return BIR_FORM_CATALOG;
  }

  /** Saved BIR forms for the actor's firm, optionally narrowed to one client. */
  async list(user: AuthUser, clientId?: string) {
    const where: Prisma.BirFormWhereInput = {
      firmId: user.firmId,
      ...(clientId ? { clientId } : {}),
    };
    const rows = await this.prisma.birForm.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: { client: { select: { businessName: true } } },
    });
    return rows.map((f) => ({
      id: f.id,
      clientId: f.clientId,
      clientName: f.client?.businessName ?? "",
      form: f.form,
      status: f.status,
      period: f.period,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    }));
  }
}
