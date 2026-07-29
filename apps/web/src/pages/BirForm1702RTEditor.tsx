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
  type BirForm1702RTComputed,
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

/** Every stored money field on the 1702-RT editor. */
const FIELD_KEYS = [
  // Part IV — income
  "i27", "i28", "i30", "i32",
  // Deductions (summary entries; the engine prefers Schedule detail when present)
  "i34", "i35", "i36",
  // Credits 44-54
  "i44", "i45", "i46", "i47", "i48", "i49", "i50", "i51", "i52", "i53", "i54",
  // Part II penalties
  "i17", "i18", "i19",
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
type Fields = Record<FieldKey, string>;
const emptyFields = (): Fields =>
  FIELD_KEYS.reduce((o, k) => ({ ...o, [k]: "" }), {} as Fields);

/** 1702-RT (Annual Income Tax, corporations at the regular rate) authoring. */
export default function BirForm1702RTEditor() {
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
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [rate, setRate] = useState("25");
  const [method, setMethod] = useState("itemized");
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from an existing form.
  useEffect(() => {
    const d = existing.data?.data as Record<string, unknown> | undefined;
    if (!d) return;
    setClientId(existing.data!.clientId);
    setYear((existing.data!.period || String(d.year ?? "")).slice(0, 4));
    if (d.rate != null) setRate(String(d.rate));
    if (d.method) setMethod(String(d.method));
    setFields((prev) => {
      const next = { ...prev };
      for (const k of FIELD_KEYS) if (d[k] != null) next[k] = String(d[k]);
      return next;
    });
  }, [existing.data]);

  const data = useMemo(() => {
    const base: Record<string, string> = { year, rate, method, amended: "no" };
    for (const k of FIELD_KEYS) if (fields[k]) base[k] = fields[k];
    return base;
  }, [year, rate, method, fields]);

  // Live authoritative totals (server compute — the browser never computes tax).
  const [debounced, setDebounced] = useState(data);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(data), 350);
    return () => window.clearTimeout(t);
  }, [data]);
  const computed = useQuery({
    queryKey: ["bir-compute-1702rt", debounced],
    queryFn: () => computeBirForm<BirForm1702RTComputed>("1702RT", debounced),
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return createBirForm({ clientId, form: "1702RT", period: year, data });
      return updateBirForm(id!, { period: year, data });
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
        title={isNew ? "New 1702-RT" : "1702-RT"}
        eyebrow="BIR Forms · Annual Income Tax (Corporations, regular rate)"
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
          {/* Filer + year + rate */}
          <Card>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
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
                  <span className="mb-1.5 block text-[13px] font-semibold text-content">
                    Taxable year
                  </span>
                  <input
                    className="input w-full font-mono"
                    value={year}
                    onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  />
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
            </CardContent>
          </Card>

          {/* Part IV — income */}
          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Part IV — income</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Money label="Sales / receipts (Item 27)" value={fields.i27} onChange={(v) => set("i27", v)} />
                <Money label="Less: returns & discounts (Item 28)" value={fields.i28} onChange={(v) => set("i28", v)} />
                <Money label="Less: cost of sales (Item 30)" value={fields.i30} onChange={(v) => set("i30", v)} />
                <Money label="Other taxable income (Item 32)" value={fields.i32} onChange={(v) => set("i32", v)} />
              </div>
              <div className="rounded-input bg-sidebar px-3 py-2 text-[12.5px]">
                <Line label="Net sales (Item 29)" value={c?.i29} />
                <Line label="Gross income from operation (Item 31)" value={c?.i31} />
                <Line label="Total gross income (Item 33)" value={c?.i33} />
              </div>
            </CardContent>
          </Card>

          {/* Deductions */}
          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Deductions</div>
              {method === "itemized" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Money label="Ordinary itemized deductions (Item 34)" value={fields.i34} onChange={(v) => set("i34", v)} />
                  <Money label="Special itemized deductions (Item 35)" value={fields.i35} onChange={(v) => set("i35", v)} />
                  <Money label="NOLCO applied this year (Item 36)" value={fields.i36} onChange={(v) => set("i36", v)} />
                </div>
              ) : (
                <p className="text-[12.5px] text-content-secondary">
                  Under OSD the deduction is a fixed 40% of gross income — no line entry needed.
                </p>
              )}
              <div className="rounded-input bg-sidebar px-3 py-2 text-[12.5px]">
                {method === "itemized" ? (
                  <Line label="Total itemized deductions (Item 37)" value={c?.i37} />
                ) : (
                  <Line label="OSD — 40% of gross income (Item 38)" value={c?.i38} />
                )}
                <Line label="Net taxable income (Item 39)" value={c?.i39} />
              </div>
            </CardContent>
          </Card>

          {/* Tax due — normal vs MCIT */}
          <Card>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="eyebrow">Income tax due</div>
                {c?.mcitApplies ? <Chip variant="warn">MCIT applies</Chip> : null}
              </div>
              <div className="rounded-input bg-sidebar px-3 py-2 text-[12.5px]">
                <Line label={`Income tax at ${c?.rate ?? rate}% (Item 41)`} value={c?.i41} />
                <Line label="MCIT — 2% of gross income (Item 42)" value={c?.i42} />
                <div className="mt-1 flex items-center justify-between border-t border-line-divider pt-1">
                  <span className="font-semibold text-content">Tax due — the higher (Item 43)</span>
                  <span className="font-mono font-semibold tabular-nums text-navy">
                    {peso(c?.i43 ?? 0)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Credits 44-54 */}
          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Tax credits / payments (Items 44-54)</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Money label="Prior year's excess credits (Item 44)" value={fields.i44} onChange={(v) => set("i44", v)} />
                <Money label="Prior year's excess (Item 45)" value={fields.i45} onChange={(v) => set("i45", v)} />
                <Money label="Quarterly payments (Item 46)" value={fields.i46} onChange={(v) => set("i46", v)} />
                <Money label="Excess MCIT applied (Item 47)" value={fields.i47} onChange={(v) => set("i47", v)} />
                <Money label="CWT, prev. quarters (Item 48)" value={fields.i48} onChange={(v) => set("i48", v)} />
                <Money label="CWT, 4th quarter (Item 49)" value={fields.i49} onChange={(v) => set("i49", v)} />
                <Money label="Foreign tax credits (Item 50)" value={fields.i50} onChange={(v) => set("i50", v)} />
                <Money label="Tax paid, prior return (Item 51)" value={fields.i51} onChange={(v) => set("i51", v)} />
                <Money label="Special tax credits (Item 52)" value={fields.i52} onChange={(v) => set("i52", v)} />
                <Money label="Other credits (Item 53)" value={fields.i53} onChange={(v) => set("i53", v)} />
                <Money label="Other credits (Item 54)" value={fields.i54} onChange={(v) => set("i54", v)} />
              </div>
              <div className="rounded-input bg-sidebar px-3 py-2 text-[12.5px]">
                <Line label="Total tax credits (Item 55)" value={c?.i55} />
                <Line label="Net tax payable (Item 56)" value={c?.i56} />
              </div>
            </CardContent>
          </Card>

          {/* Penalties */}
          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Penalties</div>
              <div className="grid grid-cols-3 gap-2">
                <Money label="Surcharge" value={fields.i17} onChange={(v) => set("i17", v)} compact />
                <Money label="Interest" value={fields.i18} onChange={(v) => set("i18", v)} compact />
                <Money label="Compromise" value={fields.i19} onChange={(v) => set("i19", v)} compact />
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
                ["Total gross income", c?.i33],
                ["Net taxable income", c?.i39],
                ["Tax due (higher)", c?.i43],
                ["Less: tax credits", c?.i55],
                ["Net tax payable", c?.i16],
                ["Penalties", c?.i20],
              ].map(([label, v]) => (
                <div key={label as string} className="flex items-center justify-between">
                  <span className="text-[13px] text-content-secondary">{label}</span>
                  <span className="font-mono tabular-nums text-content">{peso(Number(v ?? 0))}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-line-strong pt-2">
                <span className="text-[13px] font-semibold text-navy">Total amount payable</span>
                <span className={cn("font-mono text-[15px] font-semibold tabular-nums text-navy")}>
                  {peso(Number(c?.i21 ?? 0))}
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
