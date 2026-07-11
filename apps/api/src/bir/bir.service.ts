import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/** Read-only access to the global BIR tax-code reference data. */
@Injectable()
export class BirService {
  constructor(private readonly prisma: PrismaService) {}

  listTaxTypes(status?: string) {
    return this.prisma.birTaxType.findMany({
      where: status ? { status } : undefined,
      orderBy: { code: "asc" },
    });
  }

  listAtcCodes(filters: {
    classification?: string;
    taxTypeCode?: string;
    status?: string;
    search?: string;
  }) {
    const { classification, taxTypeCode, status, search } = filters;
    return this.prisma.birAtcCode.findMany({
      where: {
        ...(classification ? { classification } : {}),
        ...(taxTypeCode ? { taxTypeCode } : {}),
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { atc: { contains: search, mode: "insensitive" as const } },
                { description: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { atc: "asc" },
    });
  }
}
