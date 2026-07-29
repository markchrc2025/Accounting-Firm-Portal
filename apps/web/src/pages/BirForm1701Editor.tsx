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
  type BirForm1701Computed,
  type BirForm1701Side,
  type ClientSummary,
} from "../lib/api";
import {
  Button,
  Card,
  CardContent,
  ErrorState,
  PageHeader,
  SegPicker,
  Skeleton,
  cn,
  peso,
} from "../components/ui";

/** Per-column (A filer / B spouse) money fields the 1701 editor captures. */
const COLUMN_FIELDS = [
  "comp", "sales", "returns", "cogs", "deduct", "other", // income + deductions
  "prevPaid", "cwt", "excess", "compCwt", // credits
  "install", "surcharge", "interest", "compromise", // installment + penalties
  "ix1", "ix2", "ix3", "ix4", "ix6", "ix7", "ix8", "ix9", // Part IX reconciliation
] as const;

const ALL_KEYS: string[] = (["A", "B"] as const).flatMap((s) => [
  ...COLUMN_FIELDS.map((f) => f + s),
  "rate" + s,
  "method" + s,
]);
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

/** 1701 (Annual ITR — mixed income) authoring: create or edit, then export XML. */
export default function BirForm1701Editor() {
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
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [withSpouse, setWithSpouse] = useState(false);
  const [showRecon, setShowRecon] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from an existing form.
  useEffect(() => {
    const d = existing.data?.data as Record<string, unknown> | undefined;
    if (!d) return;
    setClientId(existing.data!.clientId);
    setYear((existing.data!.period || String(d.year ?? "")).slice(0, 4));
    setFields((prev) => {
      const next = { ...prev };
      for (const k of ALL_KEYS) if (d[k] != null) next[k] = String(d[k]);
      return next;
    });
    if (COLUMN_FIELDS.some((f) => d[f + "B"] != null && String(d[f + "B"]) !== "")) {
      setWithSpouse(true);
    }
    if (["ix1A", "ix2A", "ix6A", "ix1B"].some((k) => d[k] != null && String(d[k]) !== "")) {
      setShowRecon(true);
    }
  }, [existing.data]);

  const data = useMemo(() => {
    const base: Record<string, string> = { year, amended: "no", taxpayerType: "single" };
    for (const k of ALL_KEYS) {
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

  // Live authoritative totals (server compute — the browser never computes tax).
  const [debounced, setDebounced] = useState(data);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(data), 350);
    return () => window.clearTimeout(t);
  }, [data]);
  const computed = useQuery({
    queryKey: ["bir-compute-1701", debounced],
    queryFn: () => computeBirForm<BirForm1701Computed>("1701", debounced),
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return createBirForm({ clientId, form: "1701", period: year, data });
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
        title={isNew ? "New 1701" : "1701"}
        eyebrow="BIR Forms · Annual Income Tax (Mixed income)"
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
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-[13px] text-content">
                  <input
                    type="checkbox"
                    checked={withSpouse}
                    onChange={(e) => setWithSpouse(e.target.checked)}
                  />
                  Include spouse column
                </label>
                <label className="flex items-center gap-2 text-[13px] text-content">
                  <input
                    type="checkbox"
                    checked={showRecon}
                    onChange={(e) => setShowRecon(e.target.checked)}
                  />
                  Part IX reconciliation
                </label>
              </div>
            </CardContent>
          </Card>

          <Column
            suffix="A"
            label="Filer"
            fields={fields}
            set={set}
            side={c?.A}
            showRecon={showRecon}
          />
          {withSpouse ? (
            <Column
              suffix="B"
              label="Spouse"
              fields={fields}
              set={set}
              side={c?.B}
              showRecon={showRecon}
            />
          ) : null}
        </div>

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
              <em>authoritative</em> annual income-tax numbers on this client&apos;s tax view.
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

/** One filer/spouse column: compensation + business income, credits, penalties. */
function Column({
  suffix,
  label,
  fields,
  set,
  side,
  showRecon,
}: {
  suffix: "A" | "B";
  label: string;
  fields: Fields;
  set: (k: string, v: string) => void;
  side?: BirForm1701Side;
  showRecon: boolean;
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="eyebrow">{label} — income</div>
          <SegPicker
            value={rate}
            onChange={(v) => set("rate" + s, v)}
            options={[
              ["graduated", "Graduated"],
              ["eight", "8% flat"],
            ]}
          />
        </div>

        <Money label="Taxable compensation income" value={f("comp")} onChange={(v) => setF("comp", v)} />

        {!is8 ? (
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
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Money label="Gross sales / receipts" value={f("sales")} onChange={(v) => setF("sales", v)} />
          <Money label="Less: returns & discounts" value={f("returns")} onChange={(v) => setF("returns", v)} />
          {!is8 ? (
            <>
              <Money label="Cost of sales / services" value={f("cogs")} onChange={(v) => setF("cogs", v)} />
              {method === "itemized" ? (
                <Money label="Itemized deductions" value={f("deduct")} onChange={(v) => setF("deduct", v)} />
              ) : null}
            </>
          ) : null}
          <Money label="Other / non-operating income" value={f("other")} onChange={(v) => setF("other", v)} />
        </div>

        <div className="rounded-input bg-sidebar px-3 py-2 text-[12.5px]">
          {is8 ? (
            <>
              <Line label="Taxable business income (less ₱250k)" value={side?.taxable8} />
              <Line label="8% tax on business" value={side?.tax8biz} />
            </>
          ) : (
            <>
              <Line label="Gross income from business" value={side?.gross} />
              <Line label="Less: deductions" value={side?.deductions} />
              <Line label="Net business income" value={side?.netBizTotal} />
            </>
          )}
          <Line label="Total taxable income" value={side?.taxableTotal} />
          <div className="mt-1 flex items-center justify-between border-t border-line-divider pt-1">
            <span className="font-semibold text-content">Total income tax due</span>
            <span className="font-mono font-semibold tabular-nums text-navy">{peso(side?.taxDue ?? 0)}</span>
          </div>
        </div>

        <div>
          <div className="eyebrow mb-2">Tax credits / payments</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Money label="Prior year's excess credits" value={f("excess")} onChange={(v) => setF("excess", v)} />
            <Money label="Quarterly payments (1701Q)" value={f("prevPaid")} onChange={(v) => setF("prevPaid", v)} />
            <Money label="Creditable tax withheld (2307)" value={f("cwt")} onChange={(v) => setF("cwt", v)} />
            <Money label="Tax withheld on compensation (2316)" value={f("compCwt")} onChange={(v) => setF("compCwt", v)} />
          </div>
        </div>

        <div>
          <div className="eyebrow mb-2">Installment &amp; penalties</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Money label="Portion for 2nd installment" value={f("install")} onChange={(v) => setF("install", v)} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Money label="Surcharge" value={f("surcharge")} onChange={(v) => setF("surcharge", v)} compact />
            <Money label="Interest" value={f("interest")} onChange={(v) => setF("interest", v)} compact />
            <Money label="Compromise" value={f("compromise")} onChange={(v) => setF("compromise", v)} compact />
          </div>
        </div>

        {showRecon ? (
          <div>
            <div className="eyebrow mb-2">
              Part IX — reconciliation of net income per books
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Money label="Net income per books (Item 1)" value={f("ix1")} onChange={(v) => setF("ix1", v)} />
              <Money label="Add: non-deductible expense (Item 2)" value={f("ix2")} onChange={(v) => setF("ix2", v)} />
              <Money label="Add (Item 3)" value={f("ix3")} onChange={(v) => setF("ix3", v)} />
              <Money label="Add (Item 4)" value={f("ix4")} onChange={(v) => setF("ix4", v)} />
              <Money label="Less: final-tax income (Item 6)" value={f("ix6")} onChange={(v) => setF("ix6", v)} />
              <Money label="Less (Item 7)" value={f("ix7")} onChange={(v) => setF("ix7", v)} />
              <Money label="Less: special deduction (Item 8)" value={f("ix8")} onChange={(v) => setF("ix8", v)} />
              <Money label="Less (Item 9)" value={f("ix9")} onChange={(v) => setF("ix9", v)} />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
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

/** Compact per-column totals for the sidebar. */
function TotalsBlock({ label, side }: { label: string; side?: BirForm1701Side }) {
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[10px] uppercase tracking-[.14em] text-content-muted">{label}</div>
      {[
        ["Tax due", side?.taxDue],
        ["Tax credits", side?.credits],
        ["Tax payable", side?.payable],
        ["Less: 2nd installment", side?.installment],
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
