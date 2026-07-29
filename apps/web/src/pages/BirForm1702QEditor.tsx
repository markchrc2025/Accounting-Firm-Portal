import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ApiError,
  computeBirForm,
  createBirForm,
  exportBirForm,
  fetchBirForm,
  fetchClients,
  updateBirForm,
  type BirForm1702QComputed,
  type ClientSummary,
} from "../lib/api";
import {
  Button,
  Card,
  CardContent,
  Chip,
  ErrorState,
  PageHeader,
  SegPicker,
  Skeleton,
  cn,
  peso,
} from "../components/ui";

const QUARTERS = ["Q1", "Q2", "Q3"]; // 1702Q covers the first three quarters

/** Every stored money field on the 1702Q editor. */
const FIELD_KEYS = [
  // Schedule 2 — regular/normal rate
  "s2_1", "s2_2", "s2_4", "s2_6", "s2_8",
  // Schedule 3 — MCIT per-quarter gross income
  "sch3_1", "sch3_2", "sch3_3",
  // Schedule 4 — tax credits / payments
  "sch4_1", "sch4_2", "sch4_3", "sch4_4", "sch4_5", "sch4_6", "sch4_6a", "sch4_6b",
  // Schedule 1 — special-rate column
  "sch1_1B", "sch1_2B", "sch1_4B", "sch1_6B", "sch1_8B", "sch1_12B",
  // Part II
  "i15", "i21", "i22", "i23",
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
type Fields = Record<FieldKey, string>;
const emptyFields = (): Fields =>
  FIELD_KEYS.reduce((o, k) => ({ ...o, [k]: "" }), {} as Fields);

/** 1702Q (Quarterly Income Tax, corporations) authoring — create/edit, export XML. */
export default function BirForm1702QEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();

  const clientsQ = useQuery({ queryKey: ["clients"], queryFn: fetchClients });
  const existing = useQuery({
    queryKey: ["bir-form", id],
    queryFn: () => fetchBirForm(id!),
    enabled: !isNew,
  });

  const [clientId, setClientId] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState("Q1");
  const [rate, setRate] = useState("25");
  const [method, setMethod] = useState("itemized");
  const [sch1Rate, setSch1Rate] = useState("");
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [showSpecial, setShowSpecial] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from an existing form.
  useEffect(() => {
    const d = existing.data?.data as Record<string, unknown> | undefined;
    if (!d) return;
    setClientId(existing.data!.clientId);
    const period = existing.data!.period || "";
    const m = /^(\d{4})-(Q[1-3])$/.exec(period);
    if (m) {
      setYear(m[1]!);
      setQuarter(m[2]!);
    }
    if (d.rate != null) setRate(String(d.rate));
    if (d.method) setMethod(String(d.method));
    if (d.sch1Rate != null) setSch1Rate(String(d.sch1Rate));
    setFields((prev) => {
      const next = { ...prev };
      for (const k of FIELD_KEYS) if (d[k] != null) next[k] = String(d[k]);
      return next;
    });
    if (["sch1_1B", "sch1_4B", "sch1_8B"].some((k) => d[k] != null && String(d[k]) !== "")) {
      setShowSpecial(true);
    }
  }, [existing.data]);

  const data = useMemo(() => {
    const base: Record<string, string> = {
      year,
      // The MCIT schedule seeds the matching quarter from this quarter's gross
      // income, so the engine needs the quarter as a plain number-ish string.
      quarter: quarter.replace("Q", ""),
      rate,
      method,
      amended: "no",
    };
    if (showSpecial && sch1Rate) base.sch1Rate = sch1Rate;
    for (const k of FIELD_KEYS) {
      if (!showSpecial && k.startsWith("sch1_")) continue;
      if (fields[k]) base[k] = fields[k];
    }
    return base;
  }, [year, quarter, rate, method, sch1Rate, fields, showSpecial]);
  const period = `${year}-${quarter}`;

  // Live authoritative totals (server compute — the browser never computes tax).
  const [debounced, setDebounced] = useState(data);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(data), 350);
    return () => window.clearTimeout(t);
  }, [data]);
  const computed = useQuery({
    queryKey: ["bir-compute-1702q", debounced],
    queryFn: () => computeBirForm<BirForm1702QComputed>("1702Q", debounced),
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return createBirForm({ clientId, form: "1702Q", period, data });
      return updateBirForm(id!, { period, data });
    },
    onSuccess: (form) => {
      setError(null);
      if (isNew) navigate(`/bir-forms/${form.id}`);
      else void existing.refetch();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save the form."),
  });

  const exportXml = useMutation({
    mutationFn: () => exportBirForm(id!),
    onSuccess: (res) => {
      setError(null);
      window.open(res.url, "_blank", "noopener");
      void existing.refetch();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not export the XML."),
  });

  const setStatus = useMutation({
    mutationFn: (status: "draft" | "filed") => updateBirForm(id!, { status }),
    onSuccess: () => {
      setError(null);
      void existing.refetch();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not update the form status."),
  });

  const set = (k: FieldKey, v: string) => setFields((prev) => ({ ...prev, [k]: v }));

  if (!isNew && existing.isPending) {
    return (
      <div className="animate-fade-rise space-y-3">
        <Skeleton />
        <Skeleton className="w-2/3" />
      </div>
    );
  }
  if (!isNew && existing.isError) {
    return <ErrorState message="Could not load this form." onRetry={() => void existing.refetch()} />;
  }

  const clients = clientsQ.data ?? [];
  const c = computed.data;
  const isFiled = existing.data?.status === "filed";
  const filedAt = existing.data?.filedAt ?? null;

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title={isNew ? "New 1702Q" : "1702Q"}
        eyebrow="BIR Forms · Quarterly Income Tax (Corporations)"
        actions={
          <Button variant="ghost" onClick={() => navigate("/bir-forms")}>
            Back
          </Button>
        }
      />

      {error ? (
        <div className="mb-5 rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* Filer + period + rate */}
          <Card>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-4">
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-[13px] font-semibold text-content">Client</span>
                  <select
                    className="input w-full"
                    value={clientId}
                    disabled={!isNew}
                    onChange={(e) => setClientId(e.target.value)}
                  >
                    <option value="">Select client…</option>
                    {clients.map((cl: ClientSummary) => (
                      <option key={cl.id} value={cl.id}>
                        {cl.businessName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold text-content">Year</span>
                  <input
                    className="input w-full font-mono"
                    value={year}
                    onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold text-content">Quarter</span>
                  <select className="input w-full" value={quarter} onChange={(e) => setQuarter(e.target.value)}>
                    {QUARTERS.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold text-content">
                    Regular income-tax rate (%)
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    className="input w-full text-right font-mono tabular-nums"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                  />
                </label>
                <div className="flex items-end justify-between gap-3">
                  <span className="mb-2 text-[12.5px] text-content-secondary">Deduction method</span>
                  <SegPicker
                    value={method}
                    onChange={setMethod}
                    options={[
                      ["itemized", "Itemized"],
                      ["osd", "OSD (40%)"],
                    ]}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-[13px] text-content">
                <input
                  type="checkbox"
                  checked={showSpecial}
                  onChange={(e) => setShowSpecial(e.target.checked)}
                />
                Has exempt / special-rate income (Schedule 1)
              </label>
            </CardContent>
          </Card>

          {/* Schedule 2 — regular rate */}
          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Schedule 2 — regular / normal rate</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Money label="Sales / receipts (Item 1)" value={fields.s2_1} onChange={(v) => set("s2_1", v)} />
                <Money label="Less: cost of sales (Item 2)" value={fields.s2_2} onChange={(v) => set("s2_2", v)} />
                <Money label="Non-operating / other income (Item 4)" value={fields.s2_4} onChange={(v) => set("s2_4", v)} />
                {method === "itemized" ? (
                  <Money label="Total deductions (Item 6)" value={fields.s2_6} onChange={(v) => set("s2_6", v)} />
                ) : null}
                <Money label="Taxable income, prev. quarters (Item 8)" value={fields.s2_8} onChange={(v) => set("s2_8", v)} />
              </div>
              <div className="rounded-input bg-sidebar px-3 py-2 text-[12.5px]">
                <Line label="Total gross income (Item 5)" value={c?.s2_5} />
                {method === "osd" ? <Line label="OSD 40% (Item 6)" value={c?.s2_6} /> : null}
                <Line label="Taxable income to date (Item 9)" value={c?.s2_9} />
                <Line label={`Income tax at ${c?.rate ?? rate}% (Item 11)`} value={c?.s2_11} />
              </div>
            </CardContent>
          </Card>

          {/* Schedule 3 — MCIT */}
          <Card>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="eyebrow">Schedule 3 — minimum corporate income tax</div>
                {c?.mcitApplies ? <Chip variant="warn">MCIT applies</Chip> : null}
              </div>
              <p className="text-[12.5px] text-content-secondary">
                Enter the gross income per quarter to date. Leave blank and the current
                quarter&apos;s gross income seeds the matching row automatically.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Money label="1st quarter" value={fields.sch3_1} onChange={(v) => set("sch3_1", v)} compact />
                <Money label="2nd quarter" value={fields.sch3_2} onChange={(v) => set("sch3_2", v)} compact />
                <Money label="3rd quarter" value={fields.sch3_3} onChange={(v) => set("sch3_3", v)} compact />
              </div>
              <div className="rounded-input bg-sidebar px-3 py-2 text-[12.5px]">
                <Line label="MCIT at 2% of gross income" value={c?.mcit} />
                <div className="mt-1 flex items-center justify-between border-t border-line-divider pt-1">
                  <span className="font-semibold text-content">
                    Income tax due — higher of normal vs MCIT
                  </span>
                  <span className="font-mono font-semibold tabular-nums text-navy">
                    {peso(c?.s2_13 ?? 0)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Schedule 1 — special / exempt */}
          {showSpecial ? (
            <Card>
              <CardContent className="space-y-3">
                <div className="eyebrow">Schedule 1 — special-rate income</div>
                <label className="block sm:w-1/2">
                  <span className="mb-1.5 block text-[13px] font-semibold text-content">
                    Applicable special rate (%)
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    className="input w-full text-right font-mono tabular-nums"
                    value={sch1Rate}
                    onChange={(e) => setSch1Rate(e.target.value)}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Money label="Sales / receipts" value={fields.sch1_1B} onChange={(v) => set("sch1_1B", v)} />
                  <Money label="Less: cost of sales" value={fields.sch1_2B} onChange={(v) => set("sch1_2B", v)} />
                  <Money label="Non-operating income" value={fields.sch1_4B} onChange={(v) => set("sch1_4B", v)} />
                  <Money label="Less: deductions" value={fields.sch1_6B} onChange={(v) => set("sch1_6B", v)} />
                  <Money label="Taxable income, prev. quarters" value={fields.sch1_8B} onChange={(v) => set("sch1_8B", v)} />
                  <Money label="Less: tax credits" value={fields.sch1_12B} onChange={(v) => set("sch1_12B", v)} />
                </div>
                <div className="rounded-input bg-sidebar px-3 py-2 text-[12.5px]">
                  <Line label="Net income tax due — special rate (Item 13)" value={c?.sch1_13} />
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Schedule 4 — credits */}
          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Schedule 4 — tax credits / payments</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Money label="Prior year's excess credits" value={fields.sch4_1} onChange={(v) => set("sch4_1", v)} />
                <Money label="Payments, prev. quarters" value={fields.sch4_2} onChange={(v) => set("sch4_2", v)} />
                <Money label="MCIT payments, prev. quarters" value={fields.sch4_3} onChange={(v) => set("sch4_3", v)} />
                <Money label="CWT, prev. quarters" value={fields.sch4_4} onChange={(v) => set("sch4_4", v)} />
                <Money label="CWT this quarter (2307)" value={fields.sch4_5} onChange={(v) => set("sch4_5", v)} />
                <Money label="Tax paid, prior return" value={fields.sch4_6} onChange={(v) => set("sch4_6", v)} />
                <Money label="Other credits (a)" value={fields.sch4_6a} onChange={(v) => set("sch4_6a", v)} />
                <Money label="Other credits (b)" value={fields.sch4_6b} onChange={(v) => set("sch4_6b", v)} />
              </div>
              <div className="rounded-input bg-sidebar px-3 py-2 text-[12.5px]">
                <Line label="Total tax credits / payments (Item 7)" value={c?.sch4_7} />
              </div>
            </CardContent>
          </Card>

          {/* Part II adjustments */}
          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Part II — adjustments &amp; penalties</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Money
                  label="Less: unexpired excess prior-year MCIT (Item 15)"
                  value={fields.i15}
                  onChange={(v) => set("i15", v)}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Money label="Surcharge" value={fields.i21} onChange={(v) => set("i21", v)} compact />
                <Money label="Interest" value={fields.i22} onChange={(v) => set("i22", v)} compact />
                <Money label="Compromise" value={fields.i23} onChange={(v) => set("i23", v)} compact />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Totals + actions */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-2.5">
              <div className="eyebrow mb-1">Computed (authoritative)</div>
              {[
                ["Tax due — regular rate", c?.i14],
                ["Add: special rate", c?.i17],
                ["Aggregate tax due", c?.i18],
                ["Less: tax credits", c?.i19],
                ["Net tax payable", c?.i20],
                ["Penalties", c?.i24],
              ].map(([label, v]) => (
                <div key={label as string} className="flex items-center justify-between">
                  <span className="text-[13px] text-content-secondary">{label}</span>
                  <span className="font-mono tabular-nums text-content">{peso(Number(v ?? 0))}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-line-strong pt-2">
                <span className="text-[13px] font-semibold text-navy">Total amount payable</span>
                <span className={cn("font-mono text-[15px] font-semibold tabular-nums text-navy")}>
                  {peso(Number(c?.i25 ?? 0))}
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            <Button disabled={!clientId || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : isNew ? "Save draft" : "Save changes"}
            </Button>
            {!isNew ? (
              <Button variant="outline" disabled={exportXml.isPending} onClick={() => exportXml.mutate()}>
                {exportXml.isPending ? "Exporting…" : "Export eBIRForms XML"}
              </Button>
            ) : (
              <p className="text-center text-[11.5px] text-content-muted">
                Save the draft to enable XML export.
              </p>
            )}
            {!isNew ? (
              isFiled ? (
                <Button variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate("draft")}>
                  {setStatus.isPending ? "Reopening…" : "Reopen to draft"}
                </Button>
              ) : (
                <Button variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate("filed")}>
                  {setStatus.isPending ? "Marking…" : "Mark as filed"}
                </Button>
              )
            ) : null}
          </div>

          {isFiled ? (
            <div className="rounded-card border border-success/40 bg-success-bg px-3.5 py-2.5 text-[12.5px] text-content">
              <span className="font-semibold">Filed.</span> These figures are now the{" "}
              <em>authoritative</em> corporate income-tax numbers on this client&apos;s tax view.
              {filedAt ? (
                <span className="mt-0.5 block font-mono text-[11px] text-content-secondary">
                  Filed {new Date(filedAt).toLocaleString()}
                </span>
              ) : null}
            </div>
          ) : null}

          {!isNew && existing.data && existing.data.exports.length > 0 ? (
            <Card>
              <CardContent>
                <div className="eyebrow mb-2">Exports</div>
                <ul className="space-y-1.5">
                  {existing.data.exports.map((e) => (
                    <li key={e.id} className="font-mono text-[11.5px] text-content-secondary">
                      {e.filename}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** A read-only computed line inside a summary strip. */
function Line({ label, value }: { label: string; value?: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-content-secondary">{label}</span>
      <span className="font-mono tabular-nums text-content">{peso(value ?? 0)}</span>
    </div>
  );
}

/** A single labelled peso input. */
function Money({
  label,
  value,
  onChange,
  compact,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
}) {
  return (
    <label className="block">
      <span
        className={cn(
          "mb-1.5 block font-semibold",
          compact ? "text-[12px] text-content-secondary" : "text-[13px] text-content",
        )}
      >
        {label}
      </span>
      <input
        type="number"
        min={0}
        className="input w-full text-right font-mono tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
