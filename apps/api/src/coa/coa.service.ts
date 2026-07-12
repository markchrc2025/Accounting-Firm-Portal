import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Read-only access to the seeded PH SME chart of accounts + BIR mapping. */
@Injectable()
export class CoaService {
  constructor(private readonly prisma: PrismaService) {}

  async listAccounts(filters: { class?: string; search?: string }) {
    const { class: cls, search } = filters;
    const rows = await this.prisma.chartAccount.findMany({
      where: {
        ...(cls ? { class: cls } : {}),
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: "insensitive" as const } },
                { name: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { code: "asc" },
    });
    return rows.map((a) => ({
      ...a,
      lockDate: a.lockDate ? a.lockDate.toISOString().slice(0, 10) : null,
    }));
  }

  listMappings() {
    return this.prisma.accountTaxMapping.findMany({ orderBy: { accountCode: "asc" } });
  }
}
