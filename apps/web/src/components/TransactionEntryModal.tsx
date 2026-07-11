import { InputTaxAttribution, InputVATCategory, VatClass } from "@portal/shared";
import { useMemo, useState, type FormEvent } from "react";
import {
  ApiError,
  createIncome,
  createPurchase,
  updateIncome,
  updatePurchase,
  type Category,
  type IncomeTxn,
  type PurchaseTxn,
} from "../lib/api";
import { Button, RegimeChip } from "./ui";

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

/** VAT income may not be NON_VAT (that's the percentage regime). */
const VAT_INCOME_CLASSES = VatClass.options.filter((c) => c !== "NON_VAT");

function today(): string {
  return new Date().toISOString().slice(0, 10);
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

  // Common
  const [txnDate, setTxnDate] = useState(existing?.txnDate ?? today());
  const [referenceNo, setReferenceNo] = useState(existing?.referenceNo ?? "");
  const [party, setParty] = useState((isIncome ? inc?.customer : pur?.vendor) ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? "");
  const [netAmount, setNetAmount] = useState(String(existing?.netAmount ?? ""));

  // Income classification
  const [vatClass, setVatClass] = useState(inc?.vatClass ?? "VATABLE_12");
  const [saleToGovernment, setSaleToGovernment] = useState(
    inc?.saleToGovernment ?? false,
  );
  const [creditableVAT, setCreditableVAT] = useState(
    inc?.creditableVATWithheld5pct != null ? String(inc.creditableVATWithheld5pct) : "",
  );
  const [outputVAT, setOutputVAT] = useState(
    inc?.outputVAT != null ? String(inc.outputVAT) : "",
  );

  // Purchase classification
  const [inputVATCategory, setInputVATCategory] = useState(
    pur?.inputVATCategory ?? "DOMESTIC_PURCHASES",
  );
  const [inputVAT, setInputVAT] = useState(
    pur?.inputVAT != null ? String(pur.inputVAT) : "",
  );
  const [inputTaxAttribution, setInputTaxAttribution] = useState(
    pur?.inputTaxAttribution ?? "",
  );
  const [isCapitalGood, setIsCapitalGood] = useState(pur?.isCapitalGood ?? false);
  const [capCost, setCapCost] = useState(
    pur?.capitalGoodAcquisitionCost != null ? String(pur.capitalGoodAcquisitionCost) : "",
  );
  const [usefulLife, setUsefulLife] = useState(
    pur?.estimatedUsefulLifeMonths != null ? String(pur.estimatedUsefulLifeMonths) : "",
  );
  const [deductible, setDeductible] = useState(pur?.deductible ?? true);

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const catOptions = useMemo(
    () => categories.filter((c) => c.type === (isIncome ? "INCOME" : "EXPENSE")),
    [categories, isIncome],
  );
  const isCapitalCategory = inputVATCategory === "CAPITAL_GOODS_GT_1M";
  const amountLabel = isIncome && !isVat ? "Gross receipts" : "Net of VAT";

  function buildPayload(): Record<string, unknown> {
    const net = Number(netAmount);
    if (isIncome) {
      const p: Record<string, unknown> = {
        txnDate,
        referenceNo: referenceNo || undefined,
        customer: party || undefined,
        description,
        categoryId,
        netAmount: net,
        vatClass: isVat ? vatClass : "NON_VAT",
      };
      if (isVat) {
        p.saleToGovernment = saleToGovernment;
        if (saleToGovernment) p.creditableVATWithheld5pct = Number(creditableVAT);
        if (outputVAT !== "") p.outputVAT = Number(outputVAT);
      }
      return p;
    }
    const p: Record<string, unknown> = {
      txnDate,
      referenceNo: referenceNo || undefined,
      vendor: party || undefined,
      description,
      categoryId,
      netAmount: net,
      deductible,
    };
    if (isVat) {
      p.inputVATCategory = inputVATCategory;
      if (inputVAT !== "") p.inputVAT = Number(inputVAT);
      if (inputTaxAttribution) p.inputTaxAttribution = inputTaxAttribution;
      p.isCapitalGood = isCapitalGood;
      if (isCapitalCategory) {
        p.capitalGoodAcquisitionCost = Number(capCost);
        p.estimatedUsefulLifeMonths = Number(usefulLife);
      }
    }
    return p;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);
    const payload = buildPayload();
    try {
      if (isIncome) {
        if (existing) await updateIncome(clientId, existing.id, payload);
        else await createIncome(clientId, payload);
      } else {
        if (existing) await updatePurchase(clientId, existing.id, payload);
        else await createPurchase(clientId, payload);
      }
      onSaved();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const body = err.body as { errors?: { path: string; message: string }[] };
        if (body?.errors) {
          setFieldErrors(Object.fromEntries(body.errors.map((x) => [x.path, x.message])));
        }
      } else {
        setError("Save failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${existing ? "Edit" : "Add"} ${isIncome ? "income" : "expense"}`}
        className="flex max-h-[90vh] w-full max-w-[600px] animate-fade-rise flex-col overflow-hidden rounded-modal bg-card shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex flex-none items-center justify-between gap-3 border-b border-line px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="font-serif text-[19px] font-medium text-navy">
              {existing ? "Edit" : "Add"} {isIncome ? "income" : "expense"}
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
          {/* Scrollable body */}
          <div className="flex-1 space-y-4 overflow-auto px-6 py-5">
            <p className="text-[12.5px] text-content-secondary">
              {isVat ? "VAT-registered client" : "Percentage-tax (non-VAT) client"}
            </p>

            {error && (
              <div className="rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-sm text-danger-ink">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <input
                  type="date"
                  required
                  value={txnDate}
                  onChange={(e) => setTxnDate(e.target.value)}
                  className="input font-mono"
                />
              </Field>
              <Field label="Reference no.">
                <input
                  value={referenceNo}
                  onChange={(e) => setReferenceNo(e.target.value)}
                  className="input font-mono"
                />
              </Field>
            </div>

            <Field label={isIncome ? "Customer" : "Vendor"}>
              <input
                value={party}
                onChange={(e) => setParty(e.target.value)}
                className="input"
              />
            </Field>

            <Field label="Description" error={fieldErrors.description}>
              <input
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="input"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Category" error={fieldErrors.categoryId}>
                <select
                  required
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="input"
                >
                  <option value="">Select…</option>
                  {catOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={amountLabel} error={fieldErrors.netAmount}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-content-secondary">
                    ₱
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={netAmount}
                    onChange={(e) => setNetAmount(e.target.value)}
                    className="input pl-7 font-mono"
                  />
                </div>
              </Field>
            </div>

            {/* Income classification — VAT clients only */}
            {isIncome && isVat && (
              <div className="space-y-3 rounded-card border border-line-strong bg-paper p-4">
                <Field label="VAT class" error={fieldErrors.vatClass}>
                  <select
                    value={vatClass}
                    onChange={(e) => setVatClass(e.target.value)}
                    className="input"
                  >
                    {VAT_INCOME_CLASSES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                {vatClass === "VATABLE_12" && (
                  <>
                    <label className="flex items-center gap-2.5 text-[13px] text-content">
                      <input
                        type="checkbox"
                        checked={saleToGovernment}
                        onChange={(e) => setSaleToGovernment(e.target.checked)}
                      />
                      Sale to government (5% VAT withheld)
                    </label>
                    {saleToGovernment && (
                      <Field
                        label="Creditable VAT withheld (5%)"
                        error={fieldErrors.creditableVATWithheld5pct}
                      >
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          required
                          value={creditableVAT}
                          onChange={(e) => setCreditableVAT(e.target.value)}
                          className="input font-mono"
                        />
                      </Field>
                    )}
                    <Field label="Output VAT (advisory)" error={fieldErrors.outputVAT}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder={
                          netAmount ? String(Math.round(Number(netAmount) * 12) / 100) : ""
                        }
                        value={outputVAT}
                        onChange={(e) => setOutputVAT(e.target.value)}
                        className="input font-mono"
                      />
                    </Field>
                  </>
                )}
              </div>
            )}

            {/* Purchase classification — VAT clients only */}
            {!isIncome && isVat && (
              <div className="space-y-3 rounded-card border border-line-strong bg-paper p-4">
                <Field label="Input VAT category" error={fieldErrors.inputVATCategory}>
                  <select
                    value={inputVATCategory}
                    onChange={(e) => setInputVATCategory(e.target.value)}
                    className="input"
                  >
                    {InputVATCategory.options.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Input VAT" error={fieldErrors.inputVAT}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={inputVAT}
                      onChange={(e) => setInputVAT(e.target.value)}
                      className="input font-mono"
                    />
                  </Field>
                  <Field label="Input tax attribution">
                    <select
                      value={inputTaxAttribution}
                      onChange={(e) => setInputTaxAttribution(e.target.value)}
                      className="input"
                    >
                      <option value="">—</option>
                      {InputTaxAttribution.options.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <label className="flex items-center gap-2.5 text-[13px] text-content">
                  <input
                    type="checkbox"
                    checked={isCapitalGood}
                    onChange={(e) => setIsCapitalGood(e.target.checked)}
                  />
                  Capital good
                </label>
                {isCapitalCategory && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label="Acquisition cost"
                      error={fieldErrors.capitalGoodAcquisitionCost}
                    >
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        value={capCost}
                        onChange={(e) => setCapCost(e.target.value)}
                        className="input font-mono"
                      />
                    </Field>
                    <Field
                      label="Useful life (months)"
                      error={fieldErrors.estimatedUsefulLifeMonths}
                    >
                      <input
                        type="number"
                        min="1"
                        required
                        value={usefulLife}
                        onChange={(e) => setUsefulLife(e.target.value)}
                        className="input font-mono"
                      />
                    </Field>
                  </div>
                )}
              </div>
            )}

            {!isIncome && (
              <label className="flex items-center gap-2.5 text-[13px] text-content">
                <input
                  type="checkbox"
                  checked={deductible}
                  onChange={(e) => setDeductible(e.target.checked)}
                />
                Deductible for income tax
              </label>
            )}
          </div>

          {/* Sticky footer */}
          <div className="flex flex-none justify-end gap-2 border-t border-line px-6 py-4">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-semibold text-content">{label}</span>
      <div className="mt-1.5">{children}</div>
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}
