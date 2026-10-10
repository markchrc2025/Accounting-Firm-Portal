// track-b-w12.test.ts — W12's pure helpers: the 27 columns in their five
// groups (R5), money shown in pesos from the API's own rate (R2, R6), the
// default period (R3), the local refusals (R3) and the labels (R4, R5).

import { describe, expect, it } from "vitest";
import {
  budgetLine,
  checkLabel,
  COLUMN_GROUPS,
  defaultScanPeriod,
  estimateCounts,
  estimateSentence,
  EXPENSE_HEADERS,
  fileResultLabel,
  localRefusal,
  noFitSentence,
  phpFromUsd,
  scanStatusLabel,
  usd,
  type AiStatus,
} from "./receiptScans";

const manila = (iso: string) => new Date(`${iso}+08:00`);

describe("the 27 columns in five groups (W12 R5)", () => {
  it("covers every expenses-v2 header exactly once", () => {
    const grouped = COLUMN_GROUPS.flatMap((g) => g.columns);
    expect(grouped).toHaveLength(27);
    expect(new Set(grouped).size).toBe(27);
    expect([...grouped].sort()).toEqual([...EXPENSE_HEADERS].sort());
  });

  it("groups them as Receipt, Vendor, Amounts, Booking and Review", () => {
    expect(COLUMN_GROUPS.map((g) => g.name)).toEqual([
      "Receipt",
      "Vendor",
      "Amounts",
      "Booking",
      "Review",
    ]);
    const of = (name: string) => COLUMN_GROUPS.find((g) => g.name === name)!.columns;
    expect(of("Receipt")).toEqual(["Date", "Document Type", "Reference Number"]);
    expect(of("Amounts")).toEqual([
      "Vatable Amount",
      "VAT Amount",
      "VAT-Exempt Amount",
      "Zero-rated Amount",
      "Other Non-vatable",
      "Gross Total",
    ]);
    expect(of("Booking")).toEqual([
      "Description",
      "COA Code",
      "ATC",
      "Withholding Amount",
    ]);
    expect(of("Review")).toEqual(["Needs Review", "Remarks", "Source File"]);
    expect(of("Vendor")).toEqual([
      "Vendor TIN",
      "Vendor Branch",
      "Vendor Registered Name",
      "Vendor Lastname",
      "Vendor Firstname",
      "Vendor Middlename",
      "Trade Name",
      "Address",
      "City",
      "Province",
      "Postal Code",
    ]);
  });
});

describe("money in pesos from the API's own rate (W12 R2, R6)", () => {
  const status: AiStatus = {
    configured: true,
    enabled: true,
    month: "2026-10",
    budgetUsd: 25,
    spentUsd: 5,
    reservedUsd: 1,
    remainingUsd: 19,
    warning: false,
    usdToPhp: 62.77,
    model: "invented-model",
  };

  it("writes dollars as US$ with two decimals", () => {
    expect(usd(19)).toBe("US$19.00");
    expect(usd(0.4)).toBe("US$0.40");
    expect(usd(1234.5)).toBe("US$1,234.50");
  });

  it("converts with the rate the response carries, and no other", () => {
    expect(phpFromUsd(19, 62.77)).toBe("₱1,192.63");
    expect(phpFromUsd(19, 50)).toBe("₱950.00");
  });

  it("reads the budget line as the ruling words it", () => {
    expect(budgetLine(status)).toBe(
      "₱1,192.63 left of ₱1,569.25 this month (US$19.00 of US$25.00)",
    );
  });

  it("words the estimate, and what is left when the pile does not fit", () => {
    expect(
      estimateSentence({ estimatedUsd: 0.4, remainingUsd: 19, fits: true }, 3, 62.77),
    ).toBe(
      "About ₱25.11 (US$0.40) for 3 files. Results usually within the hour; at the latest by tomorrow.",
    );
    expect(
      estimateSentence({ estimatedUsd: 0.2, remainingUsd: 19, fits: true }, 1, 62.77),
    ).toBe(
      "About ₱12.55 (US$0.20) for 1 file. Results usually within the hour; at the latest by tomorrow.",
    );
    expect(
      noFitSentence({ estimatedUsd: 0.4, remainingUsd: 0.1, fits: false }, 62.77),
    ).toBe(
      "This pile does not fit this month's AI budget: only ₱6.28 (US$0.10) is left.",
    );
  });
});

describe("the default period (W12 R3)", () => {
  it("is the last quarter that ended, by the Manila date", () => {
    expect(defaultScanPeriod(manila("2026-10-10T10:00:00"))).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
    });
    expect(defaultScanPeriod(manila("2026-04-01T00:30:00"))).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
    expect(defaultScanPeriod(manila("2027-01-02T09:00:00"))).toEqual({
      from: "2026-10-01",
      to: "2026-12-31",
    });
    expect(defaultScanPeriod(manila("2026-07-01T00:00:00"))).toEqual({
      from: "2026-04-01",
      to: "2026-06-30",
    });
  });
});

describe("what is counted and what is refused before sending (W12 R3)", () => {
  const file = (name: string, type: string, size = 1000) => ({ name, type, size });

  it("counts PDFs by type or name, and every other file as an image", () => {
    expect(
      estimateCounts([
        file("a.jpg", "image/jpeg"),
        file("b.pdf", "application/pdf"),
        file("c.PDF", ""),
        file("d.heic", ""),
      ]),
    ).toEqual({ images: 2, pdfs: 2 });
  });

  it("refuses more than 100 files, or a file over 10 MB, in a sentence", () => {
    const many = Array.from({ length: 101 }, (_, i) => file(`r${i}.jpg`, "image/jpeg"));
    expect(localRefusal(many)).toBe(
      "A pile can hold at most 100 files; you chose 101. Choose 100 or fewer.",
    );
    expect(localRefusal(many.slice(0, 100))).toBeNull();
    expect(localRefusal([file("big.jpg", "image/jpeg", 10 * 1024 * 1024 + 1)])).toBe(
      "big.jpg is larger than 10 MB. Each file must be 10 MB or smaller.",
    );
    expect(localRefusal([file("edge.jpg", "image/jpeg", 10 * 1024 * 1024)])).toBeNull();
  });
});

describe("labels (W12 R4, R5)", () => {
  it("names each pile status", () => {
    expect(
      (["reading", "ready", "failed", "approved", "discarded"] as const).map(
        scanStatusLabel,
      ),
    ).toEqual(["Reading", "Ready for review", "Failed", "Approved", "Discarded"]);
  });

  it("names what approving would do", () => {
    expect((["posted", "held", "rejected"] as const).map(checkLabel)).toEqual([
      "Will post",
      "Will be held",
      "Will be rejected",
    ]);
  });

  it("names each file's result for the file list", () => {
    const f = (result: string, rows = 0) =>
      fileResultLabel({ result, rows: Array.from({ length: rows }) } as never);
    expect(f("read", 1)).toBe("1 receipt");
    expect(f("read", 2)).toBe("2 receipts");
    expect(f("read", 0)).toBe("No receipts");
    expect(f("pending")).toBe("Still reading");
    expect(f("not-a-receipt")).toBe("Not a receipt");
    expect(f("unreadable")).toBe("Unreadable");
    expect(f("copy-of-another-file")).toBe("Copy of another file");
    expect(f("failed")).toBe("Failed");
  });
});
