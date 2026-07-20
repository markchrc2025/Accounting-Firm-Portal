import { round2, VatClass } from "@portal/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import {
  ApiError,
  createIncome,
  createPurchase,
  fetchBirAtcCodes,
  fetchChartAccounts,
  updateIncome,
  updatePurchase,
  type Category,
  type IncomeTxn,
  type PurchaseTxn,
} from "../lib/api";
import { AccountCombobox } from "./AccountCombobox";
import { Button, cn, peso, RegimeChip } from "./ui";

export type Regime = "VAT" | "PERCENTAGE";
export type Kind = "income" | "expense";

interface Props {
  clientId: string;
  regime: Regime;
  kind: Kind;
  categories: Category[];
  existing?: IncomeTxn | PurchaseTxn | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Friendly labels for the Sales "Tax Rate" picker (a VatClass under the hood). */
const VAT_RATE_LABELS: Record<string, string> = {
  VATABLE_12: "12% VAT",
  ZERO_RATED: "0% VAT (Zero-rated)",
  EXEMPT: "VAT Exempt",
};
const VAT_RATE_OPTIONS = VatClass.options.filter((c) => c !== "NON_VAT");

/** Quick-pick payment terms (days); the field still accepts any custom value. */
const TERMS_PRESETS = ["5", "10", "15", "30"];

function addDaysIso(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00.000Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

interface Line {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discount: string;
  /** Chart-of-Accounts account NAME ("Account" column). The API stores it and
   *  resolves the per-client category from it server-side. */
  account: string;
  /** Pre-CoA records keep their category when the account is left untouched. */
  categoryId: string;
  vatClass: string; // sales tax rate
  atc: string; // Tax Code (withholding ATC)
  /** Purchases: "VAT12" applies 12% input VAT (auto-computed); "NONE" = no VAT. */
  expVat: "VAT12" | "NONE";
  /** Purchases: creditable withholding tax withheld from the supplier —
   *  auto-filled from the ATC's rate × net, still editable. */
  whtAmount: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
/** Net line amount = qty × price − discount (never below 0). */
function lineNet(l: Line): number {
  const qty = l.quantity.trim() === "" ? 1 : num(l.quantity);
  const gross = qty * num(l.unitPrice) - num(l.discount);
  return Math.max(0, Math.round(gross * 100) / 100);
}

export default function TransactionEntryModal({
  clientId,
  regime,
  kind,
  categories,
  existing,
  onClose,
  onSaved,
}: Props) {
  const isIncome = kind === "income";
  const isVat = regime === "VAT";
  const inc = existing as IncomeTxn | undefined;
  const pur = existing as PurchaseTxn | undefined;
  const editing = Boolean(existing);

  // Header
  const [docDate, setDocDate] = useState(existing?.txnDate ?? today());
  const [dueDate, setDueDate] = useState(
    (isIncome ? inc?.dueDate : pur?.dueDate) ?? "",
  );
  const [docRef, setDocRef] = useState(existing?.referenceNo ?? "");
  const [party, setParty] = useState((isIncome ? inc?.customer : pur?.vendor) ?? "");
  const [partyTin, setPartyTin] = useState(
    (isIncome ? inc?.customerTin : pur?.vendorTin) ?? "",
  );
  const [terms, setTerms] = useState(inc?.terms ?? "");

  // Lines
  const [lines, setLines] = useState<Line[]>(() => [lineFromExisting()]);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ATC codes for the Tax Code picker (withholding/VAT). Cheap + cached.
  const atcQuery = useQuery({
    queryKey: ["bir-atc", "active"],
    queryFn: () => fetchBirAtcCodes({ status: "active" }),
    staleTime: 5 * 60 * 1000,
  });

  // The firm's Chart of Accounts feeds the Account picker. Any postable,
  // non-archived account is selectable; accounts on the transaction's natural
  // side (income → Revenue, expense → Expense) sort first.
  const coaQuery = useQuery({
    queryKey: ["coa-accounts"],
    queryFn: () => fetchChartAccounts(),
    staleTime: 5 * 60 * 1000,
  });
  const preferredClass = isIncome ? "Revenue" : "Expense";
  const accounts = useMemo(() => {
    return (coaQuery.data ?? [])
      .filter((a) => !a.archived)
      .sort((a, b) => {
        const ap = a.class === preferredClass ? 0 : 1;
        const bp = b.class === preferredClass ? 0 : 1;
        return ap !== bp ? ap - bp : a.code.localeCompare(b.code);
      });
  }, [coaQuery.data, preferredClass]);

  function lineFromExisting(): Line {
    // For a record that predates line fields, show its net as qty 1 × price.
    const priceFallback = existing ? String(existing.netAmount) : "";
    return {
      description: existing?.description ?? "",
      quantity: existing?.quantity != null ? String(existing.quantity) : existing ? "1" : "1",
      unit: existing?.unit ?? "",
      unitPrice: existing?.unitPrice != null ? String(existing.unitPrice) : priceFallback,
      discount: existing?.discount != null ? String(existing.discount) : "",
      account:
        existing?.account ??
        categories.find((c) => c.id === existing?.categoryId)?.name ??
        "",
      categoryId: existing?.categoryId ?? "",
      vatClass: inc?.vatClass ?? "VATABLE_12",
      atc: (isIncome ? inc?.atc : pur?.atc) ?? "",
      expVat: existing
        ? (pur?.inputVAT ?? 0) > 0
          ? "VAT12"
          : "NONE"
        : isVat
          ? "VAT12"
          : "NONE",
      whtAmount: pur?.whtAmount != null ? String(pur.whtAmount) : "",
    };
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        description: "",
        quantity: "1",
        unit: "",
        unitPrice: "",
        discount: "",
        account: "",
        categoryId: "",
        vatClass: "VATABLE_12",
        atc: "",
        expVat: isVat ? "VAT12" : "NONE",
        whtAmount: "",
      },
    ]);
  }
  function removeLine(idx: number) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  /** Rate of a withholding ATC (fraction, e.g. 0.01), or null when unknown. */
  function atcRate(code: string): number | null {
    const c = code.trim().toUpperCase();
    if (!c) return null;
    const a = (atcQuery.data ?? []).find((x) => x.atc === c && x.classification !== "vat");
    const rate = a?.rate == null ? NaN : Number(a.rate);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const next = { ...l, ...patch };
        // Purchases: keep the withholding amount in sync with ATC rate × net
        // whenever the code or the net-affecting fields change (still editable).
        if (
          !isIncome &&
          ("atc" in patch || "quantity" in patch || "unitPrice" in patch || "discount" in patch)
        ) {
          const rate = atcRate(next.atc);
          if (rate != null) next.whtAmount = String(round2(lineNet(next) * rate));
          else if ("atc" in patch && next.atc.trim() === "") next.whtAmount = "";
        }
        return next;
      }),
    );
  }

  /** Terms in days (numeric entry) derives the Due Date from the doc date. */
  function handleTerms(value: string) {
    setTerms(value);
    if (/^\d+$/.test(value.trim())) setDueDate(addDaysIso(docDate, Number(value.trim())));
  }
  function handleDocDate(value: string) {
    setDocDate(value);
    if (isIncome && /^\d+$/.test(terms.trim()) && value) {
      setDueDate(addDaysIso(value, Number(terms.trim())));
    }
  }

  /** Per-line VAT, auto-computed (12% of net) — sales on VATABLE_12, purchases
   *  when the line's VAT code is "12% VAT". Non-VAT regimes carry none. */
  function lineVat(l: Line): number {
    if (isIncome) {
      return isVat && l.vatClass === "VATABLE_12" ? round2(lineNet(l) * 0.12) : 0;
    }
    return isVat && l.expVat === "VAT12" ? round2(lineNet(l) * 0.12) : 0;
  }
  const subtotal = lines.reduce((s, l) => s + lineNet(l), 0);
  const vatTotal = lines.reduce((s, l) => s + lineVat(l), 0);
  // Purchases: withholding reduces what is actually paid to the supplier.
  const whtTotal = isIncome ? 0 : lines.reduce((s, l) => s + num(l.whtAmount), 0);
  const grandTotal = subtotal + vatTotal - whtTotal;

  function payloadForLine(l: Line): Record<string, unknown> {
    const net = lineNet(l);
    // A chart-picked account travels as its NAME only — the server resolves
    // (or creates) the matching per-client category. Records that predate the
    // CoA picker keep their categoryId as long as the account is untouched.
    const pickedFromChart = accounts.some((a) => a.name === l.account);
    const common = {
      txnDate: docDate,
      dueDate: dueDate || undefined,
      referenceNo: docRef || undefined,
      description: l.description,
      ...(l.categoryId && !pickedFromChart ? { categoryId: l.categoryId } : {}),
      netAmount: net,
      account: l.account.trim() || undefined,
      unit: l.unit || undefined,
      quantity: l.quantity.trim() === "" ? undefined : num(l.quantity),
      unitPrice: l.unitPrice.trim() === "" ? undefined : num(l.unitPrice),
      discount: l.discount.trim() === "" ? undefined : num(l.discount),
      atc: l.atc || undefined,
    };
    if (isIncome) {
      const vat = lineVat(l);
      return {
        ...common,
        customer: party || undefined,
        customerTin: partyTin || undefined,
        terms: terms || undefined,
        vatClass: isVat ? l.vatClass : "NON_VAT",
        ...(isVat && vat > 0 ? { outputVAT: vat } : {}),
      };
    }
    const vat = lineVat(l); // auto-computed 12% when the line's VAT code says so
    const wht = num(l.whtAmount);
    return {
      ...common,
      vendor: party || undefined,
      vendorTin: partyTin || undefined,
      deductible: true,
      ...(wht > 0 ? { whtAmount: round2(wht) } : {}),
      ...(isVat
        ? {
            inputVATCategory: "DOMESTIC_PURCHASES",
            ...(vat > 0 ? { inputVAT: vat, taxAmount: vat } : {}),
          }
        : {}),
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Validate: every line needs an account (or a legacy category) + description.
    const bad = lines.findIndex(
      (l) => (!l.account.trim() && !l.categoryId) || !l.description.trim(),
    );
    if (bad >= 0) {
      setError(`Line ${bad + 1}: pick an Account and enter a description.`);
      return;
    }
    setBusy(true);
    try {
      if (editing && existing) {
        const p = payloadForLine(lines[0]!);
        if (isIncome) await updateIncome(clientId, existing.id, p);
        else await updatePurchase(clientId, existing.id, p);
      } else {
        for (const l of lines) {
          const p = payloadForLine(l);
          if (isIncome) await createIncome(clientId, p);
          else await createPurchase(clientId, p);
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  const docTitle = isIncome ? "Invoice" : "Purchases";
  const docLabel = isIncome ? "Invoice" : "Purchase"; // singular for field labels
  const partyLabel = isIncome ? "Bill / Deliver To (Customer)" : "Supplier";
  // Purchases carry three tax columns (VAT / Tax Code / WHT), so the grid is
  // wider; the modal expands instead of forcing a horizontal scroll.
  const gridCols = isIncome
    ? "grid-cols-[minmax(220px,2fr)_70px_80px_100px_100px_minmax(150px,1.3fr)_minmax(150px,1.3fr)_110px_36px]"
    : "grid-cols-[minmax(180px,2fr)_64px_76px_96px_92px_minmax(140px,1.2fr)_104px_128px_104px_104px_36px]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${editing ? "Edit" : "New"} ${docTitle}`}
        className={cn(
          "flex max-h-[92vh] w-full animate-fade-rise flex-col overflow-hidden rounded-modal bg-card shadow-modal",
          isIncome ? "max-w-[1080px]" : "max-w-[1280px]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-none items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="font-serif text-[20px] font-medium uppercase tracking-wide text-navy">
              {editing ? `Edit ${docTitle}` : docTitle}
            </h2>
            <RegimeChip regime={regime} />
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-btn border border-line-strong bg-card text-lg leading-none text-content-secondary transition-colors hover:border-navy hover:text-navy"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-auto px-6 py-5">
            {error && (
              <div className="rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-sm text-danger-ink">
                {error}
              </div>
            )}

            {/* Header */}
            <div className="grid gap-3 md:grid-cols-4">
              <Field label={`${docLabel} Ref`}>
                <input
                  value={docRef}
                  onChange={(e) => setDocRef(e.target.value)}
                  placeholder={isIncome ? "INV-0001" : "PUR-0001"}
                  className="input font-mono"
                />
              </Field>
              <Field label={`${docLabel} Date`}>
                <input
                  type="date"
                  required
                  value={docDate}
                  onChange={(e) => handleDocDate(e.target.value)}
                  className="input font-mono"
                />
              </Field>
              <Field label="Due Date">
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="input font-mono"
                />
              </Field>
              {isIncome ? (
                <Field label="Terms">
                  {/* Quick-pick days (derives the Due Date) or any custom text. */}
                  <input
                    list="terms-presets"
                    value={terms}
                    onChange={(e) => handleTerms(e.target.value)}
                    placeholder='Days (e.g. 30) or "On Delivery"'
                    className="input"
                  />
                  <datalist id="terms-presets">
                    {TERMS_PRESETS.map((d) => (
                      <option key={d} value={d}>
                        {d} days
                      </option>
                    ))}
                  </datalist>
                </Field>
              ) : (
                <div />
              )}
              <Field label={partyLabel} className="md:col-span-2">
                <input
                  value={party}
                  onChange={(e) => setParty(e.target.value)}
                  placeholder={isIncome ? "Select customer" : "Select supplier"}
                  className="input"
                />
              </Field>
              <Field label={`${isIncome ? "Customer" : "Supplier"} TIN`} className="md:col-span-2">
                <input
                  value={partyTin}
                  onChange={(e) => setPartyTin(e.target.value)}
                  placeholder="000-000-000-00000"
                  className="input font-mono"
                />
              </Field>
            </div>

            {/* Line items. No overflow wrapper of its own (it would clip the
                Account combobox dropdown) — the modal body scrolls instead. */}
            <div>
              <div className={isIncome ? "min-w-[880px]" : "min-w-[1100px]"}>
                <div
                  className={cn(
                    "grid gap-2 border-b border-line-strong pb-2 font-mono text-[10px] uppercase tracking-[.12em] text-content-secondary",
                    gridCols,
                  )}
                >
                  <span>Item / Description</span>
                  <span>Qty</span>
                  <span>Unit</span>
                  <span>Price</span>
                  <span>Discount</span>
                  <span>Account</span>
                  {isIncome ? (
                    <span>Tax Rate</span>
                  ) : (
                    <>
                      <span>VAT</span>
                      <span>Tax Code</span>
                      <span className="text-right">WHT</span>
                    </>
                  )}
                  <span className="text-right">Amount</span>
                  <span />
                </div>
                {lines.map((l, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "grid items-start gap-2 border-b border-line-divider py-2",
                      gridCols,
                    )}
                  >
                    <textarea
                      rows={1}
                      value={l.description}
                      onChange={(e) => updateLine(idx, { description: e.target.value })}
                      placeholder="Enter name or description"
                      className="input min-h-[38px] resize-y py-2"
                    />
                    <input
                      value={l.quantity}
                      onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                      inputMode="decimal"
                      placeholder="1"
                      className="input font-mono"
                    />
                    <input
                      value={l.unit}
                      onChange={(e) => updateLine(idx, { unit: e.target.value })}
                      placeholder="pc"
                      className="input"
                    />
                    <input
                      value={l.unitPrice}
                      onChange={(e) => updateLine(idx, { unitPrice: e.target.value })}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="input font-mono"
                    />
                    <input
                      value={l.discount}
                      onChange={(e) => updateLine(idx, { discount: e.target.value })}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="input font-mono"
                    />
                    <AccountCombobox
                      accounts={accounts}
                      value={accounts.find((a) => a.name === l.account)?.code ?? ""}
                      onSelect={(code) =>
                        updateLine(idx, {
                          account: code
                            ? (accounts.find((a) => a.code === code)?.name ?? "")
                            : "",
                        })
                      }
                      placeholder={l.account || "Select account…"}
                    />
                    {isIncome ? (
                      <select
                        value={isVat ? l.vatClass : "NON_VAT"}
                        disabled={!isVat}
                        onChange={(e) => updateLine(idx, { vatClass: e.target.value })}
                        className="input"
                      >
                        {isVat ? (
                          VAT_RATE_OPTIONS.map((c) => (
                            <option key={c} value={c}>
                              {VAT_RATE_LABELS[c] ?? c}
                            </option>
                          ))
                        ) : (
                          <option value="NON_VAT">Non-VAT (Percentage)</option>
                        )}
                      </select>
                    ) : (
                      <>
                        {/* VAT code — the 12% input VAT is auto-computed from it. */}
                        <select
                          value={isVat ? l.expVat : "NONE"}
                          disabled={!isVat}
                          onChange={(e) =>
                            updateLine(idx, { expVat: e.target.value as Line["expVat"] })
                          }
                          className="input"
                        >
                          {isVat ? (
                            <>
                              <option value="VAT12">12% VAT</option>
                              <option value="NONE">No VAT</option>
                            </>
                          ) : (
                            <option value="NONE">No VAT</option>
                          )}
                        </select>
                        {/* Withholding ATC — can apply alongside the VAT code. */}
                        <input
                          list="atc-codes"
                          value={l.atc}
                          onChange={(e) => updateLine(idx, { atc: e.target.value })}
                          placeholder="ATC (e.g. WI010)"
                          className="input font-mono"
                        />
                        <input
                          value={l.whtAmount}
                          onChange={(e) => updateLine(idx, { whtAmount: e.target.value })}
                          inputMode="decimal"
                          placeholder="WHT"
                          title="Withholding tax — auto-computed from the ATC rate, editable"
                          className="input font-mono text-right"
                        />
                      </>
                    )}
                    <div className="pt-2 text-right">
                      {!isIncome && lineVat(l) > 0 && (
                        <div className="font-mono text-[11px] text-content-secondary">
                          +{peso(lineVat(l))} VAT
                        </div>
                      )}
                      <div className="font-mono text-[13px] font-semibold text-navy">
                        {peso(lineNet(l))}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove line ${idx + 1}`}
                      onClick={() => removeLine(idx)}
                      disabled={lines.length === 1}
                      className={cn(
                        "mt-2 text-content-muted hover:text-danger",
                        lines.length === 1 && "opacity-30",
                      )}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <datalist id="atc-codes">
              {(atcQuery.data ?? []).map((a) => (
                <option key={a.atc} value={a.atc}>
                  {a.atc} — {a.description}
                </option>
              ))}
            </datalist>

            {!editing && (
              <button
                type="button"
                onClick={addLine}
                className="text-[13px] font-semibold text-blue hover:text-navy-hover hover:underline"
              >
                + Add Item
              </button>
            )}

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-full max-w-[300px] space-y-1.5 rounded-card border border-line-strong bg-paper px-4 py-3 text-[13.5px]">
                <div className="flex justify-between">
                  <span className="text-content-secondary">Subtotal</span>
                  <span className="font-mono">{peso(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-content-secondary">VAT</span>
                  <span className="font-mono">{peso(vatTotal)}</span>
                </div>
                {!isIncome && whtTotal > 0 && (
                  <div className="flex justify-between">
                    <span className="text-content-secondary">Less: Withholding</span>
                    <span className="font-mono">−{peso(whtTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-line pt-1.5 font-semibold text-navy">
                  <span>Total (PHP)</span>
                  <span className="font-mono">{peso(grandTotal)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-none items-center justify-between gap-2 border-t border-line px-6 py-4">
            <span className="text-[12px] text-content-muted">
              {editing
                ? "Editing one record."
                : `${lines.length} line${lines.length === 1 ? "" : "s"} → ${lines.length} record${lines.length === 1 ? "" : "s"}`}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="text-[13px] font-semibold text-content">{label}</span>
      <div className="mt-1.5">{children}</div>
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}
