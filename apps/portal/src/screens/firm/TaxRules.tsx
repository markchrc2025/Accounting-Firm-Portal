/**
 * Screen 14 — Tax Rules (firm client workspace).
 *
 * Choose the income-tax method (Graduated / Flat rate / Percentage / Simplified 8%).
 * Graduated reveals an editable bracket table seeded from the frozen TRAIN defaults;
 * the other methods show a single rate input with method-specific helper text.
 *
 * These rules drive the Portal's in-app ESTIMATE only — never the authoritative filed
 * figure, which the BIR Form Generator owns.
 */
import * as React from "react";
import { Trash2, Plus, RotateCcw } from "lucide-react";

import {
  Button,
  Card,
  Input,
  Label,
  PageHeader,
} from "@/components/ui";
import { TRAIN_BRACKETS } from "@/mock";
import type { TaxBracket } from "@/types";
import { useSession } from "@/session";
import { cn } from "@/lib/utils";

type Method = "graduated" | "flat" | "percentage" | "simplified8";

interface MethodOption {
  id: Method;
  label: string;
  blurb: string;
}

const METHODS: MethodOption[] = [
  { id: "graduated", label: "Graduated", blurb: "TRAIN progressive brackets on net taxable income." },
  { id: "flat", label: "Flat rate", blurb: "A single flat rate on net taxable income." },
  { id: "percentage", label: "Percentage", blurb: "3% percentage tax on gross receipts (2551Q)." },
  { id: "simplified8", label: "Simplified 8%", blurb: "8% on gross receipts/sales, in lieu of graduated + percentage." },
];

/** Helper text shown under the single-rate input for non-graduated methods. */
const RATE_HELP: Record<Exclude<Method, "graduated">, string> = {
  flat: "A single flat rate on net taxable income.",
  percentage: "3% percentage tax on gross receipts (2551Q).",
  simplified8: "8% on gross receipts/sales in lieu of graduated + percentage tax.",
};

/** Sensible default rate seeded per non-graduated method. */
const DEFAULT_RATE: Record<Exclude<Method, "graduated">, string> = {
  flat: "25",
  percentage: "3",
  simplified8: "8",
};

/** A bracket row carrying a stable key for the editor list. */
interface EditableBracket extends TaxBracket {
  rowId: string;
}

function seedFromTrain(): EditableBracket[] {
  return TRAIN_BRACKETS.map((b, i) => ({ ...b, rowId: `train-${i}` }));
}

/** Parse a numeric input; empty → 0. */
function toNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function TaxRulesScreen(): React.JSX.Element {
  const { activeClient } = useSession();
  const [method, setMethod] = React.useState<Method>("graduated");
  const [rate, setRate] = React.useState<string>("8");
  const [brackets, setBrackets] = React.useState<EditableBracket[]>(() => seedFromTrain());
  const nextId = React.useRef(0);

  const selectMethod = (next: Method): void => {
    setMethod(next);
    if (next !== "graduated") setRate(DEFAULT_RATE[next]);
  };

  const updateBracket = (
    rowId: string,
    field: keyof TaxBracket,
    raw: string,
  ): void => {
    setBrackets((rows) =>
      rows.map((row) => {
        if (row.rowId !== rowId) return row;
        if (field === "notOver") {
          return { ...row, notOver: raw.trim() === "" ? null : toNumber(raw) };
        }
        return { ...row, [field]: toNumber(raw) };
      }),
    );
  };

  const removeBracket = (rowId: string): void => {
    setBrackets((rows) => rows.filter((row) => row.rowId !== rowId));
  };

  const addBracket = (): void => {
    nextId.current += 1;
    setBrackets((rows) => [
      ...rows,
      { over: 0, notOver: null, baseTax: 0, rate: 0, rowId: `new-${nextId.current}` },
    ]);
  };

  const resetToTrain = (): void => setBrackets(seedFromTrain());

  const save = (): void => {
    // Prototype: rules are local-only. Persist to the API in a later phase.
    // eslint-disable-next-line no-console
    console.log("Save tax rules", { method, rate, brackets });
  };

  return (
    <>
      <PageHeader
        eyebrow={activeClient ? activeClient.name : undefined}
        title="Tax Rules"
        description={
          activeClient
            ? `How the Portal estimates income tax for ${activeClient.name}. Drives the in-app estimate only.`
            : "How the Portal estimates income tax. Drives the in-app estimate only."
        }
      />

      {/* Method picker */}
      <div
        role="radiogroup"
        aria-label="Tax method"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {METHODS.map((m) => {
          const selected = method === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => selectMethod(m.id)}
              className={cn(
                "rounded-card border bg-card px-5 py-4 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-blue/[0.14]",
                selected
                  ? "border-navy border-2 bg-rowhover"
                  : "border-line-strong hover:border-line-divider",
              )}
            >
              <div
                className={cn(
                  "text-[14px] font-semibold",
                  selected ? "text-navy" : "text-content",
                )}
              >
                {m.label}
              </div>
              <p className="mt-1 text-[12px] leading-snug text-content-secondary">
                {m.blurb}
              </p>
            </button>
          );
        })}
      </div>

      {/* Method body */}
      {method === "graduated" ? (
        <Card className="mt-5">
          <div className="flex items-center justify-between border-b border-line-divider px-6 py-4">
            <div>
              <div className="text-[14px] font-semibold text-navy">Graduated brackets</div>
              <p className="text-[12px] text-content-secondary">
                Marginal rates applied to net taxable income. Leave NOT OVER blank for the
                top (∞) bracket.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={resetToTrain}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reset to TRAIN defaults
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line-divider bg-sidebar">
                  {["Over", "Not over", "Base tax", "Rate %", ""].map((h, i) => (
                    <th
                      key={h || "actions"}
                      scope="col"
                      className={cn(
                        "px-4 py-2.5 font-mono text-[10px] font-semibold uppercase tracking-[.14em] text-content-secondary",
                        i === 4 ? "text-right" : "text-left",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {brackets.map((row) => (
                  <tr key={row.rowId} className="border-b border-line-divider last:border-0">
                    <td className="px-4 py-2">
                      <Label htmlFor={`${row.rowId}-over`} className="sr-only">
                        Over
                      </Label>
                      <Input
                        id={`${row.rowId}-over`}
                        type="number"
                        inputMode="numeric"
                        className="font-mono tabular-nums"
                        value={row.over}
                        onChange={(e) => updateBracket(row.rowId, "over", e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Label htmlFor={`${row.rowId}-notover`} className="sr-only">
                        Not over
                      </Label>
                      <Input
                        id={`${row.rowId}-notover`}
                        type="number"
                        inputMode="numeric"
                        placeholder="∞"
                        className="font-mono tabular-nums"
                        value={row.notOver ?? ""}
                        onChange={(e) =>
                          updateBracket(row.rowId, "notOver", e.target.value)
                        }
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Label htmlFor={`${row.rowId}-base`} className="sr-only">
                        Base tax
                      </Label>
                      <Input
                        id={`${row.rowId}-base`}
                        type="number"
                        inputMode="numeric"
                        className="font-mono tabular-nums"
                        value={row.baseTax}
                        onChange={(e) => updateBracket(row.rowId, "baseTax", e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Label htmlFor={`${row.rowId}-rate`} className="sr-only">
                        Rate percent
                      </Label>
                      <Input
                        id={`${row.rowId}-rate`}
                        type="number"
                        inputMode="numeric"
                        className="font-mono tabular-nums"
                        value={row.rate}
                        onChange={(e) => updateBracket(row.rowId, "rate", e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Remove bracket"
                        onClick={() => removeBracket(row.rowId)}
                      >
                        <Trash2 className="h-4 w-4 text-content-secondary" aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line-divider px-6 py-4">
            <Button variant="outline" size="sm" onClick={addBracket}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add bracket
            </Button>
            <Button variant="primary" size="sm" onClick={save}>
              Save
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="mt-5 px-6 py-5">
          <div className="max-w-xs">
            <Label htmlFor="single-rate">Rate</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <Input
                id="single-rate"
                type="number"
                inputMode="numeric"
                className="font-mono tabular-nums"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
              <span className="font-mono text-[14px] text-content-secondary">%</span>
            </div>
            <p className="mt-2 text-[12px] leading-snug text-content-secondary">
              {RATE_HELP[method]}
            </p>
          </div>
          <div className="mt-5 border-t border-line-divider pt-4">
            <Button variant="primary" size="sm" onClick={save}>
              Save
            </Button>
          </div>
        </Card>
      )}
    </>
  );
}
