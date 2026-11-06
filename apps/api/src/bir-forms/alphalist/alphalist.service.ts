// alphalist.service.ts — U19 (D59): the 1601-EQ alphalist of a return. For a DRAFT it is
// made from the client's posted expense records (the same source as the return's own
// figures, U17); for a FILED return it is read from the rows stored at filing, and never
// from the books as they are now.
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isoToDate } from "../../financial/serialization";
import { PrismaService } from "../../prisma/prisma.service";
import { bookQuarter } from "../book-figures/book-period";
import { compute1601EQ } from "../engine/compute1601EQ";
import type { FilingData } from "../engine/types";
import { buildSchedule1, type BookRecord, type PayeeNeed } from "./payees";
import { agentName, branch4, checkAgent, checkTotals } from "./qap-rules";
import { totalsOf, type AlphalistModel } from "./qap-writer";
import { readStoredAlphalist } from "./stored";

export const ONLY_1601EQ = "The alphalist file is only made for the 1601-EQ.";
export const NOT_STORED = "The alphalist was not stored when this return was filed.";
export const NO_PAYEES = "The alphalist has no payees to list.";
export const FILING_WARNING =
  "The alphalist could not be made when this return was filed, so none was stored. A filed return's alphalist cannot be made later.";

export interface AlphalistCheck {
  ok: boolean;
  /** "books" (a draft), "stored" (the rows kept at filing) or "none" (a filed return with no rows). */
  source: "books" | "stored" | "none";
  fileName: string | null;
  refusals: string[];
  /** What the Portal changed to make the file (the enye written as N). */
  notes: string[];
  schedule1: { rows: number; income: string; tax: string };
  schedule2: { rows: number; income: string };
  /** The return's Item 19, total taxes withheld for the quarter. */
  returnTotal: string;
}

/** What the connector (U20) turns into questions; the check endpoint leaves it out. */
export interface AlphalistOutcome {
  check: AlphalistCheck;
  model: AlphalistModel | null;
  payeeNeeds?: PayeeNeed[];
}


interface ReturnLike {
  status: string;
  period: string;
  dataJson: unknown;
  filedSnapshotJson: unknown;
}
interface ClientLike {
  id: string;
  tin: string | null;
  branch: string;
  rdo: string | null;
  kind: string;
  regName: string | null;
  businessName: string;
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
}

const ZERO_S = { rows: 0, income: "0.00", tax: "0.00" };

@Injectable()
export class AlphalistService {
  constructor(private readonly prisma: PrismaService) {}

  /** The return's Item 19, total taxes withheld for the quarter (items 13 to 18). */
  item19(f: Pick<ReturnLike, "dataJson">): string {
    return compute1601EQ((f.dataJson ?? {}) as unknown as FilingData).i19.toFixed(2);
  }

  /** The alphalist of a return: its check, and the model when there is one to write. */
  async inspect(f: ReturnLike, client: ClientLike): Promise<AlphalistOutcome> {
    const returnTotal = this.item19(f);
    if (f.status === "filed") {
      const stored = readStoredAlphalist(f.filedSnapshotJson);
      if (!stored.model) {
        return {
          model: null,
          check: {
            ok: false,
            source: "none",
            fileName: null,
            refusals: [NOT_STORED],
            notes: [],
            schedule1: ZERO_S,
            schedule2: { rows: 0, income: "0.00" },
            returnTotal,
          },
        };
      }
      return {
        model: stored.model,
        check: this.checkOf(stored.model, "stored", [], [], returnTotal),
      };
    }
    return this.fromBooks(f, client, returnTotal);
  }

  /** Made from the client's posted expense records for the quarter. */
  async fromBooks(
    f: ReturnLike,
    client: ClientLike,
    returnTotal: string,
  ): Promise<AlphalistOutcome> {
    const refuse = (refusals: string[], notes: string[] = []): AlphalistOutcome => ({
      model: null,
      check: {
        ok: false,
        source: "books",
        fileName: null,
        refusals,
        notes,
        schedule1: ZERO_S,
        schedule2: { rows: 0, income: "0.00" },
        returnTotal,
      },
    });

    const m = /^(\d{4})-Q([1-4])$/i.exec(f.period.trim());
    const range = m ? bookQuarter(f.period, null) : null;
    if (!m || !range)
      return refuse(["This return has no quarter, so the alphalist cannot be made."]);
    const period = `${String(Number(m[2]) * 3).padStart(2, "0")}/${m[1]}`;

    const agent = {
      tin: (client.tin ?? "").replace(/\D/g, "").slice(0, 9),
      branch: branch4(client.branch) ?? "",
      name: agentName(client),
      rdo: (client.rdo ?? "").trim(),
    };

    const [rows, table] = await Promise.all([
      this.prisma.purchaseTransaction.findMany({
        where: {
          clientId: client.id,
          status: "posted", // a held import is in no figure
          txnDate: { gte: isoToDate(range.from), lte: isoToDate(range.to) },
          whtAmount: { gt: 0 },
        },
        select: {
          id: true,
          vendor: true,
          vendorTin: true,
          vendorBranch: true,
          payeeKind: true,
          payeeLastName: true,
          payeeFirstName: true,
          payeeMiddleName: true,
          atc: true,
          netAmount: true,
          whtAmount: true,
          txnDate: true,
        },
      }),
      this.prisma.birAtcCode.findMany({
        where: { classification: "ewt" },
        select: { atc: true, rate: true },
      }),
    ]);
    const rates = new Map(
      table.map((a) => [a.atc, a.rate ? new Prisma.Decimal(a.rate).times(100) : null]),
    );
    const records: BookRecord[] = [];
    for (const r of rows) {
      const atc = (r.atc ?? "").trim().toUpperCase();
      if (!rates.has(atc)) continue; // not expanded withholding: not on this return (U17 names it)
      records.push({
        id: r.id,
        tin: r.vendorTin,
        branch: r.vendorBranch,
        vendor: r.vendor,
        kind: r.payeeKind,
        last: r.payeeLastName,
        first: r.payeeFirstName,
        middle: r.payeeMiddleName,
        atc,
        ratePct: rates.get(atc) ?? null,
        net: new Prisma.Decimal(r.netAmount),
        wht: new Prisma.Decimal(r.whtAmount ?? 0),
        at: r.txnDate,
      });
    }

    const s1 = buildSchedule1(records, new Set(rates.keys()));
    // Schedule 2 (income not subject to withholding) has no source in the books: the seed
    // holds no ATC for it and an expense cannot carry one. The writer supports it.
    const model: AlphalistModel = {
      version: 1,
      period,
      agent,
      schedule1: s1.rows,
      schedule2: [],
    };
    const refusals = [...checkAgent(agent), ...s1.refusals];
    if (refusals.length === 0 && s1.rows.length === 0) refusals.push(NO_PAYEES);
    if (refusals.length === 0) {
      const total = checkTotals(model, returnTotal);
      if (total) refusals.push(total);
    }
    if (refusals.length > 0) {
      return { ...refuse(refusals, s1.notes), payeeNeeds: s1.payeeNeeds };
    }
    return { model, check: this.checkOf(model, "books", [], s1.notes, returnTotal) };
  }

  private checkOf(
    model: AlphalistModel,
    source: "books" | "stored",
    refusals: string[],
    notes: string[],
    returnTotal: string,
  ): AlphalistCheck {
    const t = totalsOf(model);
    const [mm, yyyy] = model.period.split("/");
    return {
      ok: refusals.length === 0,
      source,
      fileName: `${model.agent.tin}${model.agent.branch}${mm}${yyyy}1601EQ.DAT`,
      refusals,
      notes,
      schedule1: t.schedule1,
      schedule2: t.schedule2,
      returnTotal,
    };
  }
}
