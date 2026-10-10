/**
 * track-a-receipt-mapping.spec.ts — U11 T9 (hermetic): every branch of R7, the
 * code that turns one receipt the AI read into the template's 27 columns.
 * Invented vendors and TINs only.
 */
import { EXPENSES_V2_HEADERS } from "@portal/shared";
import { parseAnswer, type AnswerReceipt } from "./answer";
import {
  SELLER_VAT_UNKNOWN,
  VAT_BACKED_OUT,
  mapReceipt,
  type MapContext,
} from "./mapping";
import { EXPENSES_HEADERS } from "../purchase-transactions/import/expense-import.constants";

const ctx: MapContext = {
  clientNames: ["Invented Trading", "INVENTED TRADING CORP"],
  fileName: "receipt-01.jpg",
  allowedCodes: new Set(["5002004"]),
};

const base = (over: Partial<AnswerReceipt> = {}): AnswerReceipt => ({
  date: "2026-08-10",
  documentType: "OFFICIAL_RECEIPT",
  vendor: {
    tin: "000-111-222-00000",
    branch: null,
    registeredName: "INVENTED HARDWARE CORP",
    lastName: null,
    firstName: null,
    middleName: null,
    tradeName: null,
    address: null,
    city: null,
    province: null,
    postalCode: null,
  },
  referenceNumber: "OR-0001",
  amounts: {
    vatableSales: null,
    vat: null,
    vatExempt: null,
    zeroRated: null,
    total: null,
  },
  sellerVatStatus: "VAT_REGISTERED",
  description: "Office supplies",
  coaCode: "5002004",
  soldTo: null,
  doubts: [],
  ...over,
});

const amounts = (a: Partial<AnswerReceipt["amounts"]>) => ({
  vatableSales: null,
  vat: null,
  vatExempt: null,
  zeroRated: null,
  total: null,
  ...a,
});

describe("U11 T9 · R7: one receipt → the template's 27 columns", () => {
  it("the import reads the same 27 headers the contract names (one list)", () => {
    expect(EXPENSES_HEADERS).toBe(EXPENSES_V2_HEADERS);
    expect(Object.keys(mapReceipt(base(), ctx).cells)).toEqual([...EXPENSES_V2_HEADERS]);
  });

  it("a printed breakdown is copied as printed", () => {
    const { cells } = mapReceipt(
      base({
        amounts: amounts({
          vatableSales: 1000,
          vat: 120,
          vatExempt: 50,
          zeroRated: 30,
          total: 1200,
        }),
      }),
      ctx,
    );
    expect(cells).toMatchObject({
      "Vatable Amount": 1000,
      "VAT Amount": 120,
      "VAT-Exempt Amount": 50,
      "Zero-rated Amount": 30,
      "Other Non-vatable": null,
      "Gross Total": 1200,
      "Needs Review": "N",
      Remarks: null,
    });
  });

  it("VAT_REGISTERED with only a total: VAT backed out at 12%, to centavos", () => {
    // 1,000.00 ÷ 1.12 = 892.857… → 892.86; VAT = 1,000.00 − 892.86 = 107.14.
    const { cells } = mapReceipt(base({ amounts: amounts({ total: 1000 }) }), ctx);
    expect(cells).toMatchObject({
      "Vatable Amount": 892.86,
      "VAT Amount": 107.14,
      "Gross Total": 1000,
      Remarks: VAT_BACKED_OUT,
      "Needs Review": "N",
    });
    expect(VAT_BACKED_OUT).toBe("VAT backed out of inclusive total");
  });

  it("NON_VAT: Other Non-vatable = total", () => {
    const { cells } = mapReceipt(
      base({ sellerVatStatus: "NON_VAT", amounts: amounts({ total: 350 }) }),
      ctx,
    );
    expect(cells).toMatchObject({
      "Other Non-vatable": 350,
      "Vatable Amount": null,
      "Gross Total": 350,
    });
  });

  it("UNKNOWN: Other Non-vatable = total, Needs Review, and the remark", () => {
    const { cells } = mapReceipt(
      base({ sellerVatStatus: "UNKNOWN", amounts: amounts({ total: 350 }) }),
      ctx,
    );
    expect(cells).toMatchObject({
      "Other Non-vatable": 350,
      "Needs Review": "Y",
      Remarks: SELLER_VAT_UNKNOWN,
    });
    expect(SELLER_VAT_UNKNOWN).toBe("Cannot tell whether the seller is VAT-registered.");
  });

  it("Source File is the upload's name; ATC and Withholding are always blank", () => {
    const { cells } = mapReceipt(base({ amounts: amounts({ total: 1 }) }), ctx);
    expect(cells["Source File"]).toBe("receipt-01.jpg");
    expect(cells.ATC).toBeNull();
    expect(cells["Withholding Amount"]).toBeNull();
  });

  it.each([
    [
      "a TIN outside the four forms",
      { vendor: { ...base().vendor, tin: "123-45" } },
      "Vendor TIN",
      'Read "123-45"',
    ],
    [
      "a reference over 32 characters",
      { referenceNumber: "R".repeat(33) },
      "Reference Number",
      `Read "${"R".repeat(33)}"`,
    ],
    [
      "an unknown document type",
      { documentType: "RAFFLE_TICKET" },
      "Document Type",
      'Read "RAFFLE_TICKET"',
    ],
    ["a COA code that is not allowed", { coaCode: "1001" }, "COA Code", 'Read "1001"'],
    ["a date that is not a date", { date: "2026-02-30" }, "Date", 'Read "2026-02-30"'],
  ] as const)(
    "%s becomes blank, with a doubt quoting what was read",
    (_l, over, field, quote) => {
      const { cells, doubts } = mapReceipt(
        base({ ...over, amounts: amounts({ total: 112 }) }),
        ctx,
      );
      expect(cells[field]).toBeNull();
      expect(doubts).toEqual([
        expect.objectContaining({ field, reason: expect.stringContaining(quote) }),
      ]);
      expect(cells["Needs Review"]).toBe("Y");
      expect(cells.Remarks).toContain(`${field}: ${quote}`);
    },
  );

  it("soldTo that is not the client: Needs Review, with a doubt naming whom", () => {
    const { cells, doubts } = mapReceipt(
      base({ soldTo: "Someone Else Enterprises", amounts: amounts({ total: 112 }) }),
      ctx,
    );
    expect(cells["Needs Review"]).toBe("Y");
    expect(doubts[0]!.reason).toContain('"Someone Else Enterprises"');
  });

  it("soldTo that is the client (any spelling) is not a doubt", () => {
    for (const soldTo of [
      "Invented Trading Corp.",
      "invented trading",
      "INVENTED TRADING CORP",
    ]) {
      const { doubts } = mapReceipt(
        base({ soldTo, amounts: amounts({ total: 112 }) }),
        ctx,
      );
      expect(doubts).toEqual([]);
    }
  });

  it("no TIN: Needs Review, with no doubt invented", () => {
    const { cells, doubts } = mapReceipt(
      base({ vendor: { ...base().vendor, tin: null }, amounts: amounts({ total: 112 }) }),
      ctx,
    );
    expect(cells["Needs Review"]).toBe("Y");
    expect(doubts).toEqual([]);
  });

  it("the AI's own doubts are kept and listed in Remarks in plain words", () => {
    const { cells, doubts } = mapReceipt(
      base({
        amounts: amounts({ total: 112 }),
        doubts: [{ field: "Gross Total", reason: "The total is smudged." }],
      }),
      ctx,
    );
    expect(doubts).toEqual([{ field: "Gross Total", reason: "The total is smudged." }]);
    expect(cells["Needs Review"]).toBe("Y");
    expect(cells.Remarks).toBe(
      "VAT backed out of inclusive total; Gross Total: The total is smudged.",
    );
  });

  it("an individual seller keeps last, first and middle name", () => {
    const { cells } = mapReceipt(
      base({
        vendor: {
          ...base().vendor,
          registeredName: null,
          lastName: "Halimbawa",
          firstName: "Juana",
          middleName: "Subok",
        },
        amounts: amounts({ total: 112 }),
      }),
      ctx,
    );
    expect(cells).toMatchObject({
      "Vendor Registered Name": null,
      "Vendor Lastname": "Halimbawa",
      "Vendor Firstname": "Juana",
      "Vendor Middlename": "Subok",
    });
  });

  it("review: a breakdown of 0.00s is not a printed breakdown, so the VAT is backed out", () => {
    const { cells } = mapReceipt(
      base({
        amounts: amounts({
          vatableSales: 0,
          vat: 0,
          vatExempt: 0,
          zeroRated: 0,
          total: 112,
        }),
      }),
      ctx,
    );
    expect(cells).toMatchObject({
      "Vatable Amount": 100,
      "VAT Amount": 12,
      Remarks: VAT_BACKED_OUT,
    });
  });

  it("review: a bad branch is dropped on its own; a good TIN is kept", () => {
    const { cells, doubts } = mapReceipt(
      base({
        vendor: { ...base().vendor, tin: "000-111-222", branch: "BRANCH-X" },
        amounts: amounts({ total: 112 }),
      }),
      ctx,
    );
    expect(cells["Vendor TIN"]).toBe("000-111-222");
    expect(cells["Vendor Branch"]).toBeNull();
    expect(doubts).toEqual([
      { field: "Vendor Branch", reason: 'Read "BRANCH-X", which is not a branch code.' },
    ]);
  });

  it("review: a branch with no TIN is dropped, with a doubt", () => {
    const { cells, doubts } = mapReceipt(
      base({
        vendor: { ...base().vendor, tin: null, branch: "00001" },
        amounts: amounts({ total: 112 }),
      }),
      ctx,
    );
    expect(cells["Vendor Branch"]).toBeNull();
    expect(doubts[0]).toEqual({
      field: "Vendor Branch",
      reason: 'Read branch "00001", but no TIN is printed with it.',
    });
  });

  it("review: a fragment of the client's name is not the client; the whole name inside a longer one is", () => {
    for (const soldTo of ["Cash", "Corp", "Invented"]) {
      expect(
        mapReceipt(base({ soldTo, amounts: amounts({ total: 112 }) }), ctx).doubts,
      ).toHaveLength(1);
    }
    const branch = mapReceipt(
      base({
        soldTo: "INVENTED TRADING CORP - MAIN BRANCH",
        amounts: amounts({ total: 112 }),
      }),
      ctx,
    );
    expect(branch.doubts).toEqual([]);
  });

  it("review: a NUL in the AI's answer is stripped (PostgreSQL cannot store one)", () => {
    const text = JSON.stringify({
      result: "unreadable",
      problem: `blur${String.fromCharCode(0)}red`,
      receipts: [],
    });
    expect(parseAnswer([{ type: "text", text }])?.problem).toBe("blurred");
    expect(parseAnswer([{ type: "text", text: "not json" }])).toBeNull();
  });
});
