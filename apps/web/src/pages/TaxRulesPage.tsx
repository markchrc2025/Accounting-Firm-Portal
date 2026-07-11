import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { ClientWorkspaceTabs } from "../components/ClientWorkspaceTabs";
import { useAuth } from "../auth/AuthContext";
import {
  fetchClient,
  fetchTaxRules,
  saveTaxRules,
  type TaxBracket,
  type TaxMethod,
  type TaxRule,
} from "../lib/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../components/ui";

/**
 * Per-client Tax Rules editor — configures the in-app **management estimate**
 * only. GUARDRAIL: the authoritative BIR computation is owned by the BIR Form
 * Generator; nothing here changes a filed figure.
 */

/** Standard TRAIN-law graduated income-tax schedule (annual, individuals). */
const TRAIN_DEFAULT_BRACKETS: TaxBracket[] = [
  { over: 0, notOver: 250000, baseTax: 0, rate: 0 },
  { over: 250000, notOver: 400000, baseTax: 0, rate: 15 },
  { over: 400000, notOver: 800000, baseTax: 22500, rate: 20 },
  { over: 800000, notOver: 2000000, baseTax: 102500, rate: 25 },
  { over: 2000000, notOver: 8000000, baseTax: 402500, rate: 30 },
  { over: 8000000, notOver: null, baseTax: 2202500, rate: 35 },
];

interface MethodOption {
  method: TaxMethod;
  label: string;
  helper: string;
}

const METHOD_OPTIONS: MethodOption[] = [
  {
    method: "graduated",
    label: "Graduated",
    helper: "Progressive TRAIN brackets — tax rises in tiers as income grows.",
  },
  {
    method: "flat",
    label: "Flat rate",
    helper: "A single flat rate applied to taxable income.",
  },
  {
    method: "percentage",
    label: "Percentage",
    helper: "Percentage tax on gross receipts, in lieu of VAT.",
  },
  {
    method: "simplified8",
    label: "Simplified 8%",
    helper: "8% of gross receipts in lieu of graduated income tax.",
  },
];

/** Per-method helper copy shown beside the single Rate (%) input. */
const RATE_HELP: Record<Exclude<TaxMethod, "graduated">, string> = {
  flat: "A single flat percentage applied to taxable income.",
  percentage:
    "Percentage tax on gross receipts, in lieu of VAT. The ATC and filed rate are owned by the BIR Form Generator.",
  simplified8:
    "8% of gross receipts in lieu of graduated income tax + percentage tax.",
};

/** Parse a numeric field; blank / invalid → 0. */
function toNumber(raw: string): number {
  if (raw.trim() === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export default function TaxRulesPage() {
  const { clientId = "" } = useParams();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const canConfigure = hasPermission("TaxRules:Configure");
  const readOnly = !canConfigure;

  // Local editable state, hydrated from the saved rule once it loads.
  const [method, setMethod] = useState<TaxMethod>("graduated");
  const [flatRate, setFlatRate] = useState<number | null>(null);
  const [brackets, setBrackets] = useState<TaxBracket[]>([]);
  const [justSaved, setJustSaved] = useState(false);

  const clientQ = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchClient(clientId),
    enabled: !!clientId,
  });

  const rulesQ = useQuery({
    queryKey: ["tax-rules", clientId],
    queryFn: () => fetchTaxRules(clientId),
    enabled: !!clientId,
  });

  // Hydrate local state from the query data once it arrives.
  const rulesData = rulesQ.data;
  useEffect(() => {
    if (!rulesData) return;
    setMethod(rulesData.method);
    setFlatRate(rulesData.flatRate);
    setBrackets(rulesData.brackets);
  }, [rulesData]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const body: TaxRule = { method, flatRate, brackets };
      return saveTaxRules(clientId, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tax-rules", clientId] });
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
    },
  });

  // Any edit clears the transient "Saved" note.
  const touched = () => {
    if (justSaved) setJustSaved(false);
  };

  const selectMethod = (next: TaxMethod) => {
    if (readOnly) return;
    touched();
    setMethod(next);
  };

  const updateBracket = (index: number, patch: Partial<TaxBracket>) => {
    touched();
    setBrackets((prev) =>
      prev.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    );
  };

  const removeBracket = (index: number) => {
    touched();
    setBrackets((prev) => prev.filter((_, i) => i !== index));
  };

  const addBracket = () => {
    touched();
    setBrackets((prev) => [
      ...prev,
      { over: 0, notOver: null, baseTax: 0, rate: 0 },
    ]);
  };

  const resetToTrain = () => {
    touched();
    setBrackets(TRAIN_DEFAULT_BRACKETS.map((b) => ({ ...b })));
  };

  const setRate = (raw: string) => {
    touched();
    setFlatRate(raw.trim() === "" ? null : toNumber(raw));
  };

  if (!clientId) {
    return (
      <div className="animate-fade-rise">
        <Card>
          <ErrorState message="No client selected. Open a client to configure its tax rules." />
        </Card>
      </div>
    );
  }

  const retry = () => {
    void clientQ.refetch();
    void rulesQ.refetch();
  };

  let body: ReactNode;
  if (rulesQ.isError) {
    body = (
      <Card>
        <ErrorState
          message="Could not load this client's tax-rule configuration."
          onRetry={retry}
        />
      </Card>
    );
  } else if (rulesQ.isPending || !rulesData) {
    body = (
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card className="min-w-0">
          <CardContent className="space-y-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton />
            <Skeleton className="w-3/4" />
            <Skeleton className="h-9 w-48" />
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardContent className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="w-2/3" />
          </CardContent>
        </Card>
      </div>
    );
  } else {
    body = (
      <div className="space-y-6">
        {/* Method selector */}
        <Card>
          <CardHeader>
            <CardTitle>Computation method</CardTitle>
            {readOnly ? (
              <span className="font-mono text-[10px] uppercase tracking-[.14em] text-content-muted">
                Read-only
              </span>
            ) : null}
          </CardHeader>
          <CardContent>
            <div
              role="radiogroup"
              aria-label="Tax computation method"
              className="grid gap-3 sm:grid-cols-2"
            >
              {METHOD_OPTIONS.map((opt) => {
                const selected = method === opt.method;
                return (
                  <button
                    key={opt.method}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={readOnly}
                    onClick={() => selectMethod(opt.method)}
                    className={cn(
                      "flex flex-col items-start rounded-card px-4 py-3.5 text-left transition-colors",
                      "focus-visible:outline-none disabled:cursor-not-allowed",
                      selected
                        ? "border-2 border-navy bg-rowhover"
                        : "border border-line-strong hover:border-navy",
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="font-serif text-[15px] font-medium text-navy">
                        {opt.label}
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          "flex h-4 w-4 flex-none items-center justify-center rounded-full border",
                          selected
                            ? "border-navy"
                            : "border-line-input",
                        )}
                      >
                        {selected ? (
                          <span className="h-2 w-2 rounded-full bg-navy" />
                        ) : null}
                      </span>
                    </span>
                    <span className="mt-1 text-[12.5px] leading-relaxed text-content-secondary">
                      {opt.helper}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Method-specific configuration */}
        {method === "graduated" ? (
          <Card>
            <CardHeader>
              <CardTitle>Graduated brackets</CardTitle>
              {!readOnly ? (
                <Button variant="outline" size="sm" onClick={resetToTrain}>
                  Reset to TRAIN defaults
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="overflow-x-auto rounded-input border border-line-divider">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                      <th className="px-3 py-2 font-semibold">Over</th>
                      <th className="px-3 py-2 font-semibold">Not over</th>
                      <th className="px-3 py-2 font-semibold">Base tax</th>
                      <th className="px-3 py-2 font-semibold">Rate %</th>
                      <th className="px-3 py-2" aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-divider">
                    {brackets.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-3 py-6 text-center text-[13px] text-content-secondary"
                        >
                          No brackets. Add one, or reset to the TRAIN defaults.
                        </td>
                      </tr>
                    ) : (
                      brackets.map((b, i) => (
                        <tr key={i} className="align-middle">
                          <td className="px-3 py-2">
                            <input
                              className="input font-mono tabular-nums"
                              inputMode="numeric"
                              aria-label={`Bracket ${i + 1} over`}
                              disabled={readOnly}
                              value={String(b.over)}
                              onChange={(e) =>
                                updateBracket(i, { over: toNumber(e.target.value) })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="input font-mono tabular-nums"
                              inputMode="numeric"
                              aria-label={`Bracket ${i + 1} not over`}
                              placeholder="∞"
                              disabled={readOnly}
                              value={b.notOver === null ? "" : String(b.notOver)}
                              onChange={(e) =>
                                updateBracket(i, {
                                  notOver:
                                    e.target.value.trim() === ""
                                      ? null
                                      : toNumber(e.target.value),
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="input font-mono tabular-nums"
                              inputMode="numeric"
                              aria-label={`Bracket ${i + 1} base tax`}
                              disabled={readOnly}
                              value={String(b.baseTax)}
                              onChange={(e) =>
                                updateBracket(i, {
                                  baseTax: toNumber(e.target.value),
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              className="input font-mono tabular-nums"
                              inputMode="numeric"
                              aria-label={`Bracket ${i + 1} rate percent`}
                              disabled={readOnly}
                              value={String(b.rate)}
                              onChange={(e) =>
                                updateBracket(i, { rate: toNumber(e.target.value) })
                              }
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            {!readOnly ? (
                              <button
                                type="button"
                                aria-label={`Remove bracket ${i + 1}`}
                                onClick={() => removeBracket(i)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-btn text-content-muted transition-colors hover:bg-danger-bg hover:text-danger"
                              >
                                <span aria-hidden className="text-[15px] leading-none">
                                  ✕
                                </span>
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {!readOnly ? (
                <Button variant="outline" size="sm" onClick={addBracket}>
                  + Add bracket
                </Button>
              ) : null}
              <p className="text-[12px] leading-relaxed text-content-secondary">
                Leave <span className="font-mono">Not over</span> blank for the
                open-ended top bracket (∞). Amounts are whole pesos; rate is a
                whole-number percent.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Rate</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-w-[220px]">
                <label
                  htmlFor="flat-rate"
                  className="mb-1.5 block text-[13px] font-semibold text-content"
                >
                  Rate (%)
                </label>
                <input
                  id="flat-rate"
                  className="input font-mono tabular-nums"
                  inputMode="decimal"
                  disabled={readOnly}
                  placeholder="0"
                  value={flatRate === null ? "" : String(flatRate)}
                  onChange={(e) => setRate(e.target.value)}
                />
              </div>
              <p className="max-w-prose text-[12.5px] leading-relaxed text-content-secondary">
                {RATE_HELP[method]}
              </p>
            </CardContent>
          </Card>
        )}

        {/* Save row */}
        <div className="flex items-center gap-3">
          {canConfigure ? (
            <Button
              variant="primary"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving…" : "Save tax rules"}
            </Button>
          ) : (
            <p className="text-[13px] text-content-secondary">
              You do not have permission to change this configuration. It is shown
              read-only.
            </p>
          )}
          {justSaved ? (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-success">
              <span aria-hidden>✓</span> Saved
            </span>
          ) : null}
          {saveMutation.isError ? (
            <span role="alert" className="text-[13px] font-medium text-danger">
              Could not save. Try again.
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-rise">
      <ClientWorkspaceTabs clientId={clientId} />
      <PageHeader
        title="Tax Rules"
        eyebrow="MANAGEMENT ESTIMATE CONFIG"
        description={clientQ.data?.businessName}
      />

      {/* Guardrail: this configures the in-app estimate only. */}
      <div className="mb-6 flex items-start gap-3 rounded-card border border-warn/40 bg-warn-bg-2 px-5 py-4 text-warn">
        <span className="mt-px inline-flex flex-none items-center rounded-chip bg-warn/10 px-[9px] py-[3px] font-mono text-[10px] font-semibold uppercase leading-none tracking-[.12em]">
          Estimate
        </span>
        <p className="text-[13px] leading-relaxed">
          These rules drive the in-app <strong>management estimate</strong> only.
          The authoritative BIR computation is owned by the BIR Form Generator —
          nothing configured here changes a filed figure.
        </p>
      </div>

      {body}
    </div>
  );
}
