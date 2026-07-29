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
  type BirForm1701QComputed,
  type BirForm1701QSide,
  type ClientSummary,
} from "../lib/api";
import {
  Button,
  Card,
  CardContent,
  ErrorState,
  PageHeader,
  Skeleton,
  cn,
  peso,
} from "../components/ui";

const QUARTERS = ["Q1", "Q2", "Q3"]; // 1701Q covers Q1-Q3 only

/** The per-column (A filer / B spouse) money fields the editor captures. */
const COLUMN_FIELDS = [
  "sales", "cogs", "deduct", "prevTaxable", "nonOp", "gpp", "prev8",
  "excess", "prevPaid", "cwtPrev", "cwt", "taxPaidPrev", "foreignCredits", "otherCredits",
  "surcharge", "interest", "compromise",
] as const;

/** All stored keys: per-column money fields (suffixed A/B) + rate/method selectors. */
const ALL_KEYS: string[] = [
  ...(["A", "B"] as const).flatMap((s) => [
    ...COLUMN_FIELDS.map((f) => f + s),
    "rate" + s,
    "method" + s,
  ]),
];
type Fields = Record<string, string>;
const emptyFields = (): Fields => {
  const o: Fields = {};
  for (const k of ALL_KEYS) o[k] = "";
  for (const s of ["A", "B"]) {
    o["rate" + s] = "graduated";
    o["method" + s] = "osd";
  }
  return o;
};

/** 1701Q (Quarterly Income Tax, individuals) authoring — create or edit, export XML. */
export default function BirForm1701QEditor() {
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
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [withSpouse, setWithSpouse] = useState(false);
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
    setFields((prev) => {
      const next = { ...prev };
      for (const k of ALL_KEYS) if (d[k] != null) next[k] = String(d[k]);
      return next;
    });
    // Reveal the spouse column if any B-column value was entered.
    if (COLUMN_FIELDS.some((f) => d[f + "B"] != null && String(d[f + "B"]) !== "")) {
      setWithSpouse(true);
    }
  }, [existing.data]);

  const data = useMemo(() => {
    const base: Record<string, string> = { year, amended: "no", filerType: "single" };
    for (const k of ALL_KEYS) {
      // Drop B-column money entries when spouse is not included.
      if (!withSpouse && k.endsWith("B") && k !== "rateB" && k !== "methodB") continue;
      if (fields[k]) base[k] = fields[k]!;
    }
    // Always carry the rate/method selectors so compute picks the right schedule.
    base.rateA = fields.rateA || "graduated";
    base.methodA = fields.methodA || "osd";
    if (withSpouse) {
      base.rateB = fields.rateB || "graduated";
      base.methodB = fields.methodB || "osd";
    }
    return base;
  }, [year, fields, withSpouse]);
  const period = `${year}-${quarter}`;

  // Live authoritative totals (server compute — the browser never computes tax).
  const [debounced, setDebounced] = useState(data);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(data), 350);
    return () => window.clearTimeout(t);
  }, [data]);
  const computed = useQuery({
    queryKey: ["bir-compute-1701q", debounced],
    queryFn: () => computeBirForm<BirForm1701QComputed>("1701Q", debounced),
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return createBirForm({ clientId, form: "1701Q", period, data });
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

  // Filing lifecycle: mark filed (figures flow to the client tax view) / reopen.
  const setStatus = useMutation({
    mutationFn: (status: "draft" | "filed") => updateBirForm(id!, { status }),
    onSuccess: () => {
      setError(null);
      void existing.refetch();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not update the form status."),
  });

  const set = (k: string, v: string) => setFields((prev) => ({ ...prev, [k]: v }));

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
        title={isNew ? "New 1701Q" : "1701Q"}
        eyebrow="BIR Forms · Quarterly Income Tax (Individuals)"
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
          {/* Filer + period */}
          <Card>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
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
              <label className="flex items-center gap-2 text-[13px] text-content">
                <input
                  type="checkbox"
                  checked={withSpouse}
                  onChange={(e) => setWithSpouse(e.target.checked)}
                />
                Include spouse column (joint filing)
              </label>
            </CardContent>
          </Card>

          <Column suffix="A" label="Filer" fields={fields} set={set} side={c?.A} />
          {withSpouse ? (
            <Column suffix="B" label="Spouse" fields={fields} set={set} side={c?.B} />
          ) : null}
        </div>

        {/* Totals + actions */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-2.5">
              <div className="eyebrow mb-1">Computed (authoritative)</div>
              <TotalsBlock label="Filer" side={c?.A} />
              {withSpouse ? (
                <div className="border-t border-line-divider pt-2.5">
                  <TotalsBlock label="Spouse" side={c?.B} />
                </div>
              ) : null}
              <div className="flex items-center justify-between border-t border-line-strong pt-2">
                <span className="text-[13px] font-semibold text-navy">Aggregate amount payable</span>
                <span className={cn("font-mono text-[15px] font-semibold tabular-nums text-navy")}>
                  {peso(Number(c?.aggregate ?? 0))}
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
              <em>authoritative</em> income-tax numbers on this client&apos;s tax view.
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

/** One filer/spouse column: rate toggle + the relevant schedule inputs + credits/penalties. */
function Column({
  suffix,
  label,
  fields,
  set,
  side,
}: {
  suffix: "A" | "B";
  label: string;
  fields: Fields;
  set: (k: string, v: string) => void;
  side?: BirForm1701QSide;
}) {
  const s = suffix;
  const rate = fields["rate" + s] || "graduated";
  const method = fields["method" + s] || "osd";
  const is8 = rate === "eight";
  const f = (k: string) => fields[k + s] ?? "";
  const setF = (k: string, v: string) => set(k + s, v);

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="eyebrow">{label} — income &amp; deductions</div>
          <SegPicker
            value={rate}
            onChange={(v) => set("rate" + s, v)}
            options={[
              ["graduated", "Graduated"],
              ["eight", "8% flat"],
            ]}
          />
        </div>

        {is8 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Money label="Net sales / receipts (Item 47)" value={f("sales")} onChange={(v) => setF("sales", v)} />
            <Money label="Non-operating income (Item 48)" value={f("nonOp")} onChange={(v) => setF("nonOp", v)} />
            <Money label="Taxable from prev. quarters (Item 50)" value={f("prev8")} onChange={(v) => setF("prev8", v)} />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] text-content-secondary">Deduction method</span>
              <SegPicker
                value={method}
                onChange={(v) => set("method" + s, v)}
                options={[
                  ["osd", "OSD (40%)"],
                  ["itemized", "Itemized"],
                ]}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Money label="Net sales / receipts (Item 36)" value={f("sales")} onChange={(v) => setF("sales", v)} />
              <Money label="Cost of sales / services (Item 37)" value={f("cogs")} onChange={(v) => setF("cogs", v)} />
              {method === "itemized" ? (
                <Money label="Itemized deductions (Item 39)" value={f("deduct")} onChange={(v) => setF("deduct", v)} />
              ) : null}
              <Money label="Taxable from prev. quarters (Item 42)" value={f("prevTaxable")} onChange={(v) => setF("prevTaxable", v)} />
              <Money label="Non-operating income (Item 43)" value={f("nonOp")} onChange={(v) => setF("nonOp", v)} />
              <Money label="Share in GPP income (Item 44)" value={f("gpp")} onChange={(v) => setF("gpp", v)} />
            </div>
          </>
        )}

        <div className="rounded-input bg-sidebar px-3 py-2 text-[12.5px]">
          <div className="flex items-center justify-between">
            <span className="text-content-secondary">Taxable income to date</span>
            <span className="font-mono font-semibold tabular-nums text-navy">
              {peso(is8 ? side?.taxable8 ?? 0 : side?.taxableCum ?? 0)}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-content-secondary">Tax due</span>
            <span className="font-mono font-semibold tabular-nums text-navy">{peso(side?.taxDue ?? 0)}</span>
          </div>
        </div>

        <div>
          <div className="eyebrow mb-2">Tax credits / payments</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Money label="Prior year's excess credits (Item 55)" value={f("excess")} onChange={(v) => setF("excess", v)} />
            <Money label="Payments, prev. quarters (Item 56)" value={f("prevPaid")} onChange={(v) => setF("prevPaid", v)} />
            <Money label="CWT, prev. quarters (Item 57)" value={f("cwtPrev")} onChange={(v) => setF("cwtPrev", v)} />
            <Money label="CWT this quarter — 2307 (Item 58)" value={f("cwt")} onChange={(v) => setF("cwt", v)} />
            <Money label="Tax paid, prior return (Item 59)" value={f("taxPaidPrev")} onChange={(v) => setF("taxPaidPrev", v)} />
            <Money label="Foreign tax credits (Item 60)" value={f("foreignCredits")} onChange={(v) => setF("foreignCredits", v)} />
            <Money label="Other credits (Item 61)" value={f("otherCredits")} onChange={(v) => setF("otherCredits", v)} />
          </div>
        </div>

        <div>
          <div className="eyebrow mb-2">Penalties</div>
          <div className="grid grid-cols-3 gap-2">
            <Money label="Surcharge" value={f("surcharge")} onChange={(v) => setF("surcharge", v)} compact />
            <Money label="Interest" value={f("interest")} onChange={(v) => setF("interest", v)} compact />
            <Money label="Compromise" value={f("compromise")} onChange={(v) => setF("compromise", v)} compact />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Compact per-column totals for the sidebar. */
function TotalsBlock({ label, side }: { label: string; side?: BirForm1701QSide }) {
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[10px] uppercase tracking-[.14em] text-content-muted">{label}</div>
      {[
        ["Tax due", side?.taxDue],
        ["Tax credits", side?.credits],
        ["Tax payable", side?.payable],
        ["Penalties", side?.penalties],
        ["Total payable", side?.totalPayable],
      ].map(([l, v]) => (
        <div key={l as string} className="flex items-center justify-between">
          <span className="text-[13px] text-content-secondary">{l}</span>
          <span className="font-mono tabular-nums text-content">{peso(Number(v ?? 0))}</span>
        </div>
      ))}
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

/** A small segmented two/-three-option picker. */
function SegPicker({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-line bg-sidebar p-0.5">
      {options.map(([val, lbl]) => (
        <button
          key={val}
          type="button"
          onClick={() => onChange(val)}
          className={cn(
            "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
            value === val ? "bg-navy text-white shadow-sm" : "text-content-secondary hover:text-content",
          )}
        >
          {lbl}
        </button>
      ))}
    </div>
  );
}
