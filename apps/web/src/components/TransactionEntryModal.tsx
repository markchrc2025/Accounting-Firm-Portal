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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${existing ? "Edit" : "Add"} ${isIncome ? "income" : "expense"}`}
        className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold">
          {existing ? "Edit" : "Add"} {isIncome ? "income" : "expense"}
        </h2>
        <p className="mb-4 text-xs text-gray-500">
          {isVat ? "VAT-registered client" : "Percentage-tax (non-VAT) client"}
        </p>

        {error && (
          <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <input
                type="date"
                required
                value={txnDate}
                onChange={(e) => setTxnDate(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Reference no.">
              <input
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                className="input"
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
            <Field label={`${amountLabel} (₱)`} error={fieldErrors.netAmount}>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={netAmount}
                onChange={(e) => setNetAmount(e.target.value)}
                className="input"
              />
            </Field>
          </div>

          {/* Income classification — VAT clients only */}
          {isIncome && isVat && (
            <div className="rounded border border-gray-200 p-3">
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
                  <label className="mt-2 flex items-center gap-2 text-sm">
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
                        className="input"
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
                      className="input"
                    />
                  </Field>
                </>
              )}
            </div>
          )}

          {/* Purchase classification — VAT clients only */}
          {!isIncome && isVat && (
            <div className="rounded border border-gray-200 p-3">
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
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Field label="Input VAT" error={fieldErrors.inputVAT}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={inputVAT}
                    onChange={(e) => setInputVAT(e.target.value)}
                    className="input"
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
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isCapitalGood}
                  onChange={(e) => setIsCapitalGood(e.target.checked)}
                />
                Capital good
              </label>
              {isCapitalCategory && (
                <div className="mt-2 grid grid-cols-2 gap-3">
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
                      className="input"
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
                      className="input"
                    />
                  </Field>
                </div>
              )}
            </div>
          )}

          {!isIncome && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={deductible}
                onChange={(e) => setDeductible(e.target.checked)}
              />
              Deductible for income tax
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-gray-300 px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
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
    <label className="block text-sm">
      <span className="font-medium text-gray-700">{label}</span>
      <div className="mt-1">{children}</div>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}
