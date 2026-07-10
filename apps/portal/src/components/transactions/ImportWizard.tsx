/**
 * Import wizard (screen 12) — a linear 3-step stepper: upload → validate → done.
 *
 * The validation preview is a simulated static (the prototype's canned result). Only valid
 * rows are "imported"; the error rows show an indented `field — message` line exactly as
 * the spec describes. Regime drives the expected columns + template.
 */
import * as React from "react";
import { Check, FileSpreadsheet, UploadCloud } from "lucide-react";

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Regime, TransactionKind } from "@/types";

type Step = 1 | 2 | 3;

interface PreviewRow {
  ref: string;
  ok: boolean;
  /** `field — message` shown indented under an error row. */
  error?: string;
}

const VALID_COUNT = 212;
const ERROR_COUNT = 2;

/** Canned validation preview mirroring the README error examples. */
const PREVIEW_ROWS: PreviewRow[] = [
  { ref: "SI-1051", ok: true },
  { ref: "SI-1052", ok: true },
  {
    ref: "SI-1053",
    ok: false,
    error: "date — Invalid format — expected YYYY-MM-DD (got “06/28/2026”)",
  },
  { ref: "SI-1054", ok: true },
  {
    ref: "SI-1055",
    ok: false,
    error: "vat_class — Unknown value “ZERO-RATED” — did you mean ZERO_RATED?",
  },
  { ref: "SI-1056", ok: true },
];

function expectedColumns(regime: Regime, kind: TransactionKind): string {
  if (kind === "income") {
    return regime === "VAT"
      ? "date, reference, customer, category, vat_class, net_amount"
      : "date, reference, customer, category, gross_receipts";
  }
  return regime === "VAT"
    ? "date, reference, supplier, category, input_vat_category, input_tax_attribution, amount, deductible"
    : "date, reference, supplier, category, amount, deductible";
}

function StepDots({ step }: { step: Step }): React.JSX.Element {
  const labels = ["Upload", "Validate", "Done"];
  return (
    <div className="flex items-center gap-2">
      {labels.map((label, i) => {
        const n = (i + 1) as Step;
        const done = step > n;
        const active = step === n;
        return (
          <React.Fragment key={label}>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px]",
                  done && "bg-navy text-white",
                  active && "border-2 border-gold bg-card text-navy",
                  !done && !active && "border border-line-strong bg-card text-content-muted",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : n}
              </span>
              <span
                className={cn(
                  "text-[12px] font-semibold",
                  active ? "text-navy" : "text-content-secondary",
                  active && "border-b-2 border-gold pb-0.5",
                )}
              >
                {label}
              </span>
            </div>
            {i < labels.length - 1 && <span className="h-px w-6 bg-line-strong" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  regime: Regime;
  kind: TransactionKind;
  /** Called on "View list" from the success step. */
  onDone?: () => void;
}

export function ImportWizard({
  open,
  onOpenChange,
  regime,
  kind,
  onDone,
}: ImportWizardProps): React.JSX.Element {
  const [step, setStep] = React.useState<Step>(1);
  const [fileName, setFileName] = React.useState("sales-jun-2026.csv");

  React.useEffect(() => {
    if (open) {
      setStep(1);
      setFileName("sales-jun-2026.csv");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px]">
        <DialogHeader className="flex-col items-start gap-3">
          <DialogTitle>Import {kind === "income" ? "sales" : "expenses"}</DialogTitle>
          <StepDots step={step} />
        </DialogHeader>

        <DialogBody>
          {step === 1 && (
            <div className="space-y-4">
              <label
                htmlFor="import-file"
                className="flex cursor-pointer flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-paper px-6 py-12 text-center transition-colors hover:border-navy"
              >
                <UploadCloud className="mb-3 h-8 w-8 text-content-muted" aria-hidden="true" />
                <p className="font-serif text-[17px] font-medium text-navy">
                  Drop a CSV or XLSX file
                </p>
                <p className="mt-1 text-[12.5px] text-content-secondary">
                  Up to 10,000 rows. Expected columns:
                </p>
                <p className="mt-1 font-mono text-[11.5px] text-content-tertiary">
                  {expectedColumns(regime, kind)}
                </p>
                <span className="mt-4 inline-flex items-center rounded-btn border border-line-input bg-card px-4 py-[7px] text-[13px] font-semibold text-navy">
                  Browse files
                </span>
                <input
                  id="import-file"
                  type="file"
                  accept=".csv,.xlsx"
                  className="sr-only"
                  onChange={(e) => {
                    const name = e.target.files?.[0]?.name;
                    if (name) setFileName(name);
                    setStep(2);
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="text-[12.5px] font-semibold text-blue hover:text-navy-hover hover:underline"
              >
                Download the {regime === "VAT" ? "VAT" : "percentage-tax"} import template →
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-2 rounded-chip bg-neutralchip-bg px-3 py-1 font-mono text-[11px] text-neutralchip">
                  <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                  {fileName}
                </span>
                <span className="rounded-chip bg-success-bg px-[9px] py-[3px] font-mono text-[11px] font-semibold text-success">
                  {VALID_COUNT} valid
                </span>
                <span className="rounded-chip bg-danger-bg-2 px-[9px] py-[3px] font-mono text-[11px] font-semibold text-danger">
                  {ERROR_COUNT} errors
                </span>
              </div>
              <div className="overflow-hidden rounded-card border border-line-strong">
                {PREVIEW_ROWS.map((row) => (
                  <div
                    key={row.ref}
                    className={cn(
                      "border-b border-line-divider px-4 py-2.5 last:border-b-0",
                      row.ok ? "bg-[#f7fbf5]" : "bg-[#fdf4f2]",
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-white",
                          row.ok ? "bg-success" : "bg-danger",
                        )}
                        aria-hidden="true"
                      >
                        {row.ok ? "✓" : "!"}
                      </span>
                      <span className="font-mono text-[12.5px] text-content">{row.ref}</span>
                    </div>
                    {row.error && (
                      <p className="ml-[26px] mt-1 font-mono text-[11.5px] text-danger-ink">
                        {row.error}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[12px] text-content-muted">
                Showing a sample of the {VALID_COUNT + ERROR_COUNT} parsed rows. Only valid rows
                are imported.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center py-6 text-center">
              <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success text-white">
                <Check className="h-6 w-6" strokeWidth={3} aria-hidden="true" />
              </span>
              <h3 className="font-serif text-[24px] font-medium text-navy">
                {VALID_COUNT} records imported
              </h3>
              <p className="mt-1.5 text-[13px] text-content-secondary">
                {ERROR_COUNT} rows with errors were skipped and can be re-uploaded after fixing.
              </p>
              <div className="mt-6 grid w-full grid-cols-3 gap-3 text-left">
                {[
                  { label: "Total value", value: "₱4,182,650.00" },
                  { label: "Period", value: "2026-Q2" },
                  { label: "Duplicates merged", value: "6" },
                ].map((s) => (
                  <div key={s.label} className="rounded-card border border-line-strong bg-paper px-4 py-3">
                    <div className="eyebrow mb-1">{s.label}</div>
                    <div className="font-mono text-[14px] text-content">{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          {step === 1 && (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}
          {step === 2 && (
            <>
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => setStep(3)}>Import {VALID_COUNT} valid rows</Button>
            </>
          )}
          {step === 3 && (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>
                Import another
              </Button>
              <Button
                onClick={() => {
                  onOpenChange(false);
                  onDone?.();
                }}
              >
                View {kind === "income" ? "sales" : "expenses"} list
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
