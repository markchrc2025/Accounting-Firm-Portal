// Part3Entry — the entry table of one Part III block of the 2307 (C8).
//
// Block A is the income payments subject to expanded withholding tax; block B (new in C8) is
// the money payments subject to withholding of business tax (government and private). Both
// have the printed form's columns: the ATC, the income payment of each of the quarter's three
// months, the total, and the tax withheld, and a description line for the row.
//
//   * the ATC is chosen from the seeded table (AtcPicker); a new row has none;
//   * the total of a row is the server's exact sum (compute2307), shown, never typed;
//   * amounts have centavos as typed: a third decimal is not accepted;
//   * the tax withheld is typed, never derived from a rate.

import { Fragment, useState } from "react";
import type { BirAtcCode } from "../../lib/api";
import { Button, peso } from "../ui";
import { AtcPicker, type Part3Block } from "./AtcPicker";

export interface Part3Row {
  atc: string;
  desc: string;
  m1: string;
  m2: string;
  m3: string;
  tax: string;
}

/** A new row has no ATC: the accountant chooses one (W3 R6). */
export const emptyPart3Row = (): Part3Row => ({
  atc: "",
  desc: "",
  m1: "",
  m2: "",
  m3: "",
  tax: "",
});

/** Whether a typed amount may be kept: centavos only, so no third decimal. */
export function acceptsAmount(v: string): boolean {
  return !/\.\d{3,}/.test(v);
}

export const THIRD_DECIMAL =
  "Amounts have pesos and centavos only: a third decimal is not accepted.";

/** The rows the form has room for in a block. */
export const PART3_MAX_ROWS = 10;

const MONTHS = ["m1", "m2", "m3"] as const;
const MONTH_LABEL = { m1: "1st month", m2: "2nd month", m3: "3rd month" } as const;

export function Part3Entry({
  block,
  rows,
  setRows,
  rowTotals,
  table,
  tableLoading,
  tableFailed,
}: {
  block: Part3Block;
  rows: Part3Row[];
  setRows: (next: (prev: Part3Row[]) => Part3Row[]) => void;
  /** Each row's quarter total, from the server's compute. */
  rowTotals: number[];
  table: BirAtcCode[] | undefined;
  tableLoading?: boolean;
  tableFailed?: boolean;
}) {
  const [refused, setRefused] = useState(false);
  // Block A keeps at least one line, as it always has; block B may be empty.
  const minRows = block === "A" ? 1 : 0;
  const tag = block === "A" ? "" : "block B ";

  function update(i: number, patch: Partial<Part3Row>): void {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function amount(i: number, k: "m1" | "m2" | "m3" | "tax", v: string): void {
    if (!acceptsAmount(v)) {
      setRefused(true);
      return;
    }
    setRefused(false);
    update(i, { [k]: v });
  }

  return (
    <div data-part3-entry={block}>
      {block === "B" && rows.length === 0 ? (
        <p className="mb-3 text-[12.5px] text-content-secondary">
          No money payments subject to withholding of business tax on this certificate.
          Add a line for each ATC.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                <th className="px-3 py-2.5 font-semibold">ATC</th>
                <th className="px-3 py-2.5 text-right font-semibold">1st month</th>
                <th className="px-3 py-2.5 text-right font-semibold">2nd month</th>
                <th className="px-3 py-2.5 text-right font-semibold">3rd month</th>
                <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                <th className="px-3 py-2.5 text-right font-semibold">Tax withheld</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                // Each line is two table rows: the ATC and amounts, then its Part III
                // description at full width, so the added field squeezes no column (W3 F14).
                <Fragment key={i}>
                  <tr className={i > 0 ? "border-t border-line-divider" : undefined}>
                    <td className="px-3 py-2 align-top">
                      <AtcPicker
                        label={`ATC, ${tag}row ${i + 1}`}
                        block={block}
                        value={r.atc}
                        onChange={(atc) => update(i, { atc })}
                        table={table}
                        loading={tableLoading}
                        failed={tableFailed}
                      />
                    </td>
                    {MONTHS.map((k) => (
                      <td key={k} className="px-3 py-2 align-top">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          aria-label={
                            block === "B"
                              ? `${MONTH_LABEL[k]}, ${tag}row ${i + 1}`
                              : undefined
                          }
                          className="input w-full text-right font-mono tabular-nums"
                          value={r[k]}
                          onChange={(e) => amount(i, k, e.target.value)}
                        />
                      </td>
                    ))}
                    <td
                      className="px-3 py-2 text-right align-top font-mono tabular-nums text-content"
                      data-testid={`part3-total-${block}-${i + 1}`}
                    >
                      {peso(rowTotals[i] ?? 0)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        aria-label={
                          block === "B" ? `Tax withheld, ${tag}row ${i + 1}` : undefined
                        }
                        className="input w-full text-right font-mono tabular-nums"
                        value={r.tax}
                        onChange={(e) => amount(i, "tax", e.target.value)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        aria-label={
                          block === "B" ? `Remove ${tag}row ${i + 1}` : undefined
                        }
                        disabled={rows.length <= minRows}
                        onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                      >
                        ✕
                      </Button>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={7} className="px-3 pb-2.5 pt-0">
                      <input
                        className="input w-full"
                        aria-label={`Income payment, ${tag}row ${i + 1}`}
                        placeholder={
                          block === "A"
                            ? "Income payment — the description Part III prints for this line"
                            : "Money payment — the description Part III prints for this line"
                        }
                        value={r.desc}
                        onChange={(e) => update(i, { desc: e.target.value })}
                      />
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {refused ? (
        <p
          role="alert"
          data-testid="third-decimal"
          className="mt-2 text-[12px] text-danger-ink"
        >
          {THIRD_DECIMAL}
        </p>
      ) : null}
      {rows.length < PART3_MAX_ROWS ? (
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRows((p) => [...p, emptyPart3Row()])}
          >
            {block === "A" ? "+ Add line" : "+ Add block B line"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
