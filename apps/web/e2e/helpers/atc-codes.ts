// atc-codes.ts — a hermetic stand-in for GET /api/v1/bir/atc-codes (the seeded BirAtcCode
// table) for the specs that open the 2307 editor (C8). The shape is the seed's; the subset is
// small and the codes are public BIR reference data: no person's data.
import type { Page } from "@playwright/test";

const code = (
  atc: string,
  classification: string,
  taxTypeCode: string,
  description: string,
  rate: string,
  over: Record<string, unknown> = {},
) => ({
  atc,
  classification,
  taxTypeCode,
  payeeType: "any",
  description,
  condition: null,
  rate,
  rateBasis: "gross_payment",
  thresholdAmount: null,
  bracket: null,
  forms: [],
  certificate: "2307",
  status: "active",
  notes: null,
  ...over,
});

export const ATC_TABLE = [
  code(
    "WI010",
    "ewt",
    "WE",
    "Professional fees paid to individuals - gross income not over 3M",
    "0.050000",
  ),
  code(
    "WI011",
    "ewt",
    "WE",
    "Professional fees paid to individuals - gross income over 3M",
    "0.100000",
  ),
  code(
    "WI158",
    "ewt",
    "WE",
    "Income payments made by top withholding agents to local suppliers of goods",
    "0.010000",
  ),
  code(
    "WC010",
    "ewt",
    "WE",
    "Professional fees paid to corporations - gross income not over 720,000",
    "0.100000",
  ),
  code(
    "WC158",
    "ewt",
    "WE",
    "Income payments made by top withholding agents to local suppliers of goods (corporations)",
    "0.010000",
  ),
  code("WC650", "ewt", "WE", "Utility-specific legacy code", "0.150000", {
    status: "legacy",
  }),
  code("WI161", "fwt", "WF", "Final withholding - invented sample", "0.200000"),
  code("VB010", "vat", "VT", "VAT - invented sample", "0.120000"),
  code(
    "WB030",
    "percentage_wt",
    "WG",
    "Tax on carriers and keepers of garages (common carrier's tax)",
    "0.030000",
  ),
  code(
    "WB040",
    "percentage_wt",
    "WG",
    "Franchise tax - gas and water utilities",
    "0.020000",
  ),
  code(
    "WB200",
    "percentage_wt",
    "ST",
    "Stock transaction tax - sale of shares listed and traded through the exchange",
    "0.001000",
    {
      certificate: null,
    },
  ),
  code(
    "WV010",
    "wvat",
    "WG",
    "VAT withheld on purchases of goods - government withholding",
    "0.050000",
  ),
  code(
    "WV012",
    "wvat",
    "WG",
    "VAT withheld on purchase of goods (legacy rate)",
    "0.100000",
    { status: "legacy" },
  ),
];

/** Answer the ATC table. Register after the spec's own catch-all: the last route answers first. */
export async function mockAtcCodes(page: Page): Promise<void> {
  await page.route("**/api/v1/bir/atc-codes", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ATC_TABLE),
    }),
  );
}
