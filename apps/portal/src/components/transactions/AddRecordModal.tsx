/**
 * Add-Record modal (screen 11) — the regime-aware core of the product.
 *
 * The regime (VAT / PERCENTAGE) and the record kind (income / expense) drive which
 * classification controls appear and how the live summary card recomputes. Enum values
 * are the EXACT frozen `@portal/shared` strings (surfaced in friendly labels).
 *
 * Guardrails honoured here:
 *  - amounts are stored NET of VAT (VAT carried separately);
 *  - the Portal supplies amounts only — no authoritative tax is computed;
 *  - PERCENTAGE income is always NON_VAT and tracks gross receipts.
 */
import * as React from "react";

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  RegimeChip,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { cn, peso } from "@/lib/utils";
import { api } from "@/mock";
import type {
  AnyTxn,
  InputTaxAttribution,
  InputVATCategory,
  Regime,
  TransactionKind,
  VatClass,
} from "@/types";

const VAT_CLASS_OPTIONS: { value: VatClass; label: string }[] = [
  { value: "VATABLE_12", label: "Vatable sales — 12% (VATABLE_12)" },
  { value: "ZERO_RATED", label: "Zero-rated sales — 0% (ZERO_RATED)" },
  { value: "EXEMPT", label: "VAT-exempt sales (EXEMPT)" },
  { value: "NON_VAT", label: "Non-VAT (NON_VAT)" },
];

const INPUT_VAT_OPTIONS: { value: InputVATCategory; label: string }[] = [
  { value: "DOMESTIC_PURCHASES", label: "Domestic purchases (DOMESTIC_PURCHASES)" },
  { value: "SERVICES_NONRESIDENT", label: "Services by non-resident (SERVICES_NONRESIDENT)" },
  { value: "IMPORTATION_GOODS", label: "Importation of goods (IMPORTATION_GOODS)" },
  { value: "OTHERS_WITH_INPUT_TAX", label: "Others with input tax (OTHERS_WITH_INPUT_TAX)" },
  { value: "DOMESTIC_NO_INPUT_TAX", label: "Domestic — no input tax (DOMESTIC_NO_INPUT_TAX)" },
  { value: "VAT_EXEMPT_IMPORTATION", label: "VAT-exempt importation (VAT_EXEMPT_IMPORTATION)" },
  { value: "CAPITAL_GOODS_GT_1M", label: "Capital goods > ₱1M (CAPITAL_GOODS_GT_1M)" },
];

const ATTRIBUTION_OPTIONS: { value: InputTaxAttribution; label: string }[] = [
  { value: "VATABLE", label: "Attributable to vatable sales (VATABLE)" },
  { value: "EXEMPT", label: "Attributable to exempt sales (EXEMPT)" },
  { value: "MIXED", label: "Mixed / cannot be directly attributed (MIXED)" },
];

const VAT_RATE = 0.12;
const PCT_RATE = 0.03;
const GOV_FINAL_VAT = 0.05;
const MAX_USEFUL_LIFE = 60;

function formatDisplayDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

/** A single row in the live summary card. */
function SummaryRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span
        className={cn(
          "text-[12.5px] text-content-secondary",
          strong && "font-semibold text-content",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-[13px] text-content",
          strong && "font-semibold text-navy",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export interface AddRecordModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  regime: Regime;
  /** Sales opens with income; Expenses with expense. */
  defaultKind?: TransactionKind;
  /** Lock the kind toggle (e.g. Portal sales — income only). */
  lockKind?: boolean;
  /** Period the record belongs to, e.g. "2026-Q2". */
  period: string;
  onSaved?: (txn: AnyTxn) => void;
}

export function AddRecordModal({
  open,
  onOpenChange,
  clientId,
  clientName,
  regime,
  defaultKind = "income",
  lockKind = false,
  period,
  onSaved,
}: AddRecordModalProps): React.JSX.Element {
  const [kind, setKind] = React.useState<TransactionKind>(defaultKind);
  const [date, setDate] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [party, setParty] = React.useState(""); // customer | supplier
  const [category, setCategory] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  // VAT income
  const [vatClass, setVatClass] = React.useState<VatClass>("VATABLE_12");
  const [saleToGov, setSaleToGov] = React.useState(false);
  // VAT expense
  const [inputCat, setInputCat] = React.useState<InputVATCategory>("DOMESTIC_PURCHASES");
  const [attribution, setAttribution] = React.useState<InputTaxAttribution>("VATABLE");
  const [usefulLife, setUsefulLife] = React.useState("60");
  const [deductible, setDeductible] = React.useState(true);

  // Reset when (re)opened so each entry starts clean.
  React.useEffect(() => {
    if (open) {
      setKind(defaultKind);
      setDate("");
      setReference("");
      setParty("");
      setCategory("");
      setAmount("");
      setVatClass(regime === "PERCENTAGE" ? "NON_VAT" : "VATABLE_12");
      setSaleToGov(false);
      setInputCat("DOMESTIC_PURCHASES");
      setAttribution("VATABLE");
      setUsefulLife("60");
      setDeductible(true);
    }
  }, [open, defaultKind, regime]);

  const amt = Number.parseFloat(amount) || 0;
  const isVat = regime === "VAT";
  const isIncome = kind === "income";
  const isCapitalGoods = inputCat === "CAPITAL_GOODS_GT_1M";
  const life = Math.min(Math.max(Number.parseInt(usefulLife, 10) || 1, 1), MAX_USEFUL_LIFE);

  const amountLabel = isVat
    ? "Net amount (net of VAT)"
    : isIncome
      ? "Gross receipts"
      : "Expense amount";

  // Live summary lines (screen 11).
  const summary: { label: string; value: string; strong?: boolean }[] = React.useMemo(() => {
    if (isVat && isIncome) {
      const outputVat = vatClass === "VATABLE_12" ? amt * VAT_RATE : 0;
      return [
        { label: "Net amount", value: peso(amt) },
        { label: "Output VAT (12%)", value: peso(outputVat) },
        { label: "Invoice total", value: peso(amt + outputVat), strong: true },
      ];
    }
    if (isVat && !isIncome) {
      const inputVat = amt * VAT_RATE;
      return [
        { label: "Net amount", value: peso(amt) },
        { label: "Input VAT (12%)", value: peso(inputVat) },
        { label: "Invoice total", value: peso(amt + inputVat), strong: true },
      ];
    }
    if (!isVat && isIncome) {
      const pctTax = amt * PCT_RATE;
      return [
        { label: "Gross receipts", value: peso(amt) },
        { label: "Percentage tax (3%)", value: peso(pctTax) },
        { label: "Net of percentage tax", value: peso(amt - pctTax), strong: true },
      ];
    }
    return [
      { label: "Expense amount", value: peso(amt) },
      { label: "Deductible portion", value: peso(deductible ? amt : 0) },
      { label: "Recorded total", value: peso(amt), strong: true },
    ];
  }, [isVat, isIncome, amt, vatClass, deductible]);

  const monthlyAmortizedInputVat = isCapitalGoods ? (amt * VAT_RATE) / life : 0;
  const govFinalVat = saleToGov ? amt * GOV_FINAL_VAT : 0;

  const canSave = date.trim() !== "" && party.trim() !== "" && amt > 0 && !saving;

  async function handleSubmit(closeAfter: boolean): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    try {
      const displayDate = formatDisplayDate(date);
      const txn = await api.createTransaction(
        isIncome
          ? {
              clientId,
              kind: "income",
              date: displayDate,
              reference: reference.trim(),
              customer: party.trim(),
              category: category.trim(),
              vatClass: isVat ? vatClass : "NON_VAT",
              netAmount: amt,
              ...(isVat && saleToGov ? { saleToGov: true } : {}),
              period,
              source: "manual",
            }
          : {
              clientId,
              kind: "expense",
              date: displayDate,
              reference: reference.trim(),
              supplier: party.trim(),
              category: category.trim(),
              inputVatCategory: isVat ? inputCat : null,
              inputTaxAttribution: isVat ? attribution : null,
              deductible,
              amount: amt,
              ...(isVat && isCapitalGoods ? { usefulLifeMonths: life } : {}),
              period,
              source: "manual",
            },
      );
      onSaved?.(txn);
      if (closeAfter) {
        onOpenChange(false);
      } else {
        // "Save & add another" — clear the entry fields, keep the modal open.
        setDate("");
        setReference("");
        setParty("");
        setCategory("");
        setAmount("");
        setSaleToGov(false);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="max-w-[600px]">
        <DialogHeader className="justify-between">
          <div className="flex items-center gap-3">
            <DialogTitle>Add record</DialogTitle>
            <span className="text-[12.5px] text-content-secondary">{clientName}</span>
            <RegimeChip regime={regime} />
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-btn border border-line-strong bg-card text-content-secondary transition-colors hover:border-navy hover:text-navy"
          >
            ×
          </button>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* Income / Expense segmented toggle */}
          <div className="inline-flex rounded-btn border border-line-input bg-paper p-0.5">
            {(["income", "expense"] as const).map((k) => (
              <button
                key={k}
                type="button"
                disabled={lockKind && k !== defaultKind}
                onClick={() => setKind(k)}
                className={cn(
                  "rounded-[5px] px-4 py-1.5 text-[13px] font-semibold capitalize transition-colors",
                  kind === k
                    ? "bg-card text-navy shadow-[0_1px_2px_rgba(14,33,44,.08)]"
                    : "text-content-secondary hover:text-navy",
                  lockKind && k !== defaultKind && "cursor-not-allowed opacity-40",
                )}
              >
                {k}
              </button>
            ))}
          </div>

          {/* Common fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rec-date">Date</Label>
              <Input
                id="rec-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="rec-ref">Reference</Label>
              <Input
                id="rec-ref"
                className="font-mono"
                placeholder={isIncome ? "SI-1043" : "EXP-0872"}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rec-party">{isIncome ? "Customer" : "Supplier"}</Label>
              <Input
                id="rec-party"
                value={party}
                onChange={(e) => setParty(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="rec-category">Category</Label>
              <Input
                id="rec-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="rec-amount">{amountLabel}</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[13px] text-content-secondary">
                ₱
              </span>
              <Input
                id="rec-amount"
                inputMode="decimal"
                className="pl-7 font-mono"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          {/* VAT + Income */}
          {isVat && isIncome && (
            <div className="space-y-3">
              <div>
                <Label>VAT class</Label>
                <Select value={vatClass} onValueChange={(v) => setVatClass(v as VatClass)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VAT_CLASS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2.5 text-[13px] text-content">
                <Checkbox
                  checked={saleToGov}
                  onCheckedChange={(c) => setSaleToGov(c === true)}
                />
                Sale to government or GOCC
              </label>
              {saleToGov && (
                <div className="rounded-input border border-warn/40 bg-warn-bg-2 px-3.5 py-2.5 text-[12.5px] text-warn">
                  5% final VAT withheld by government buyer —{" "}
                  <span className="font-mono">{peso(govFinalVat)}</span>
                </div>
              )}
            </div>
          )}

          {/* VAT + Expense */}
          {isVat && !isIncome && (
            <div className="space-y-3">
              <div>
                <Label>Input VAT category</Label>
                <Select
                  value={inputCat}
                  onValueChange={(v) => setInputCat(v as InputVATCategory)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INPUT_VAT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {isCapitalGoods && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="rec-life">Useful life (months)</Label>
                    <Input
                      id="rec-life"
                      inputMode="numeric"
                      className="font-mono"
                      value={usefulLife}
                      onChange={(e) => setUsefulLife(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="rec-amort">Monthly amortized input VAT</Label>
                    <Input
                      id="rec-amort"
                      disabled
                      className="font-mono"
                      value={peso(monthlyAmortizedInputVat)}
                      readOnly
                    />
                  </div>
                  <p className="col-span-2 -mt-1 text-[11.5px] text-content-muted">
                    Input VAT is spread over the asset's useful life (max 60 months).
                  </p>
                </div>
              )}
              <div>
                <Label>Input tax attribution</Label>
                <Select
                  value={attribution}
                  onValueChange={(v) => setAttribution(v as InputTaxAttribution)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ATTRIBUTION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2.5 text-[13px] text-content">
                <Checkbox
                  checked={deductible}
                  onCheckedChange={(c) => setDeductible(c === true)}
                />
                Deductible for income tax
              </label>
            </div>
          )}

          {/* PERCENTAGE + Income */}
          {!isVat && isIncome && (
            <div className="space-y-2 rounded-input border border-line-strong bg-paper px-3.5 py-3">
              <span className="inline-flex items-center rounded-chip bg-warn-bg-2 px-[9px] py-[3px] font-mono text-[11px] font-semibold text-gold-deep">
                NON_VAT
              </span>
              <p className="text-[12.5px] text-content-secondary">
                Percentage-tax clients are always non-VAT; a 3% percentage tax is filed via
                2551Q.
              </p>
            </div>
          )}

          {/* PERCENTAGE + Expense */}
          {!isVat && !isIncome && (
            <div className="space-y-3">
              <label className="flex items-center gap-2.5 text-[13px] text-content">
                <Checkbox
                  checked={deductible}
                  onCheckedChange={(c) => setDeductible(c === true)}
                />
                Deductible for income tax
              </label>
              <p className="text-[11.5px] text-content-muted">
                Input VAT is not tracked for percentage-tax clients.
              </p>
            </div>
          )}

          {/* Live summary card */}
          <div className="rounded-card border border-line-strong bg-paper px-4 py-3">
            <div className="eyebrow mb-1">Summary</div>
            {summary.map((row) => (
              <SummaryRow key={row.label} {...row} />
            ))}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSubmit(false)}
            disabled={!canSave}
          >
            Save &amp; add another
          </Button>
          <Button onClick={() => handleSubmit(true)} disabled={!canSave}>
            Save record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
