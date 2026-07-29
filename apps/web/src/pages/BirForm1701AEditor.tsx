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
  type BirForm1701AComputed,
  type BirForm1701ASide,
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

/** Per-column (A filer / B spouse) money fields the 1701A editor captures. */
const COLUMN_ITEMS = [
  "36", "37", "41", "42", "43", // graduated / OSD schedule
  "47", "48", "50", "51", // 8% schedule
  "57", "58", "59", "60", "61", "62", "63", // credits
  "23", "25", "26", "27", // installment + penalties
] as const;

const ALL_KEYS: string[] = (["A", "B"] as const).flatMap((s) =>
  COLUMN_ITEMS.map((i) => `i${i}${s}`),
);
type Fields = Record<string, string>;
const emptyFields = (): Fields => {
  const o: Fields = {};
  for (const k of ALL_KEYS) o[k] = "";
  return o;
};

/** 1701A (Annual ITR — 8% / OSD filers) authoring: create or edit, then export XML. */
export default function BirForm1701AEditor() {
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
  const [taxRate, setTaxRate] = useState("graduated");
  const [fields, setFields] = useState<Fields>(emptyFields);
  const [withSpouse, setWithSpouse] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from an existing form.
  useEffect(() => {
    const d = existing.data?.data as Record<string, unknown> | undefined;
    if (!d) return;
    setClientId(existing.data!.clientId);
    setYear((existing.data!.period || String(d.year ?? "")).slice(0, 4));
    if (d.taxRate) setTaxRate(String(d.taxRate));
    setFields((prev) => {
      const next = { ...prev };
      for (const k of ALL_KEYS) if (d[k] != null) next[k] = String(d[k]);
      return next;
    });
    if (COLUMN_ITEMS.some((i) => d[`i${i}B`] != null && String(d[`i${i}B`]) !== "")) {
      setWithSpouse(true);
    }
  }, [existing.data]);

  const data = useMemo(() => {
    const base: Record<string, string> = { year, taxRate, amended: "no" };
    for (const k of ALL_KEYS) {
      if (!withSpouse && k.endsWith("B")) continue;
      if (fields[k]) base[k] = fields[k]!;
    }
    return base;
  }, [year, taxRate, fields, withSpouse]);

  // Live authoritative totals (server compute — the browser never computes tax).
  const [debounced, setDebounced] = useState(data);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(data), 350);
    return () => window.clearTimeout(t);
  }, [data]);
  const computed = useQuery({
    queryKey: ["bir-compute-1701a", debounced],
    queryFn: () => computeBirForm<BirForm1701AComputed>("1701A", debounced),
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return createBirForm({ clientId, form: "1701A", period: year, data });
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
        title={isNew ? "New 1701A" : "1701A"}
        eyebrow="BIR Forms · Annual Income Tax (8% / OSD)"
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[12.5px] text-content-secondary">Tax rate</span>
                <SegPicker
                  value={taxRate}
                  onChange={setTaxRate}
                  options={[
                    ["graduated", "Graduated + OSD"],
                    ["eight", "8% flat"],
                  ]}
                />
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

          <Column suffix="A" label="Filer" taxRate={taxRate} fields={fields} set={set} side={c?.A} />
          {withSpouse ? (
            <Column suffix="B" label="Spouse" taxRate={taxRate} fields={fields} set={set} side={c?.B} />
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
                  {peso(Number(c?.i30 ?? 0))}
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

/** One filer/spouse column: the rate-appropriate schedule + credits + penalties. */
function Column({
  suffix,
  label,
  taxRate,
  fields,
  set,
  side,
}: {
  suffix: "A" | "B";
  label: string;
  taxRate: string;
  fields: Fields;
  set: (k: string, v: string) => void;
  side?: BirForm1701ASide;
}) {
  const is8 = taxRate === "eight";
  const f = (i: string) => fields[`i${i}${suffix}`] ?? "";
  const setF = (i: string, v: string) => set(`i${i}${suffix}`, v);

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="eyebrow">{label} — income &amp; deductions</div>

        {is8 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Money label="Gross sales / receipts (Item 47)" value={f("47")} onChange={(v) => setF("47", v)} />
            <Money label="Less: returns & discounts (Item 48)" value={f("48")} onChange={(v) => setF("48", v)} />
            <Money label="Other non-operating income (Item 50)" value={f("50")} onChange={(v) => setF("50", v)} />
            <Money label="Other income (Item 51)" value={f("51")} onChange={(v) => setF("51", v)} />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Money label="Gross sales / receipts (Item 36)" value={f("36")} onChange={(v) => setF("36", v)} />
            <Money label="Less: returns & discounts (Item 37)" value={f("37")} onChange={(v) => setF("37", v)} />
            <Money label="Other income (Item 41)" value={f("41")} onChange={(v) => setF("41", v)} />
            <Money label="Other income (Item 42)" value={f("42")} onChange={(v) => setF("42", v)} />
            <Money label="Other income (Item 43)" value={f("43")} onChange={(v) => setF("43", v)} />
          </div>
        )}

        <div className="rounded-input bg-sidebar px-3 py-2 text-[12.5px]">
          {is8 ? (
            <>
              <Line label="Total taxable (Item 53)" value={side?.i53} />
              <Line label="Less: ₱250,000 relief (Item 54)" value={side?.i54} />
              <Line label="Taxable income (Item 55)" value={side?.i55} />
            </>
          ) : (
            <>
              <Line label="Net sales (Item 38)" value={side?.i38} />
              <Line label="Less: OSD 40% (Item 39)" value={side?.i39} />
              <Line label="Total taxable income (Item 45)" value={side?.i45} />
            </>
          )}
          <div className="mt-1 flex items-center justify-between border-t border-line-divider pt-1">
            <span className="font-semibold text-content">Tax due</span>
            <span className="font-mono font-semibold tabular-nums text-navy">{peso(side?.taxDue ?? 0)}</span>
          </div>
        </div>

        <div>
          <div className="eyebrow mb-2">Tax credits / payments</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Money label="Prior year's excess credits (Item 57)" value={f("57")} onChange={(v) => setF("57", v)} />
            <Money label="Quarterly tax payments (Item 58)" value={f("58")} onChange={(v) => setF("58", v)} />
            <Money label="Creditable tax withheld (Item 59)" value={f("59")} onChange={(v) => setF("59", v)} />
            <Money label="Tax withheld, prev. quarters (Item 60)" value={f("60")} onChange={(v) => setF("60", v)} />
            <Money label="Foreign tax credits (Item 61)" value={f("61")} onChange={(v) => setF("61", v)} />
            <Money label="Tax paid, prior return (Item 62)" value={f("62")} onChange={(v) => setF("62", v)} />
            <Money label="Other credits (Item 63)" value={f("63")} onChange={(v) => setF("63", v)} />
          </div>
        </div>

        <div>
          <div className="eyebrow mb-2">Installment &amp; penalties</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Money label="Portion for 2nd installment (Item 23)" value={f("23")} onChange={(v) => setF("23", v)} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Money label="Surcharge" value={f("25")} onChange={(v) => setF("25", v)} compact />
            <Money label="Interest" value={f("26")} onChange={(v) => setF("26", v)} compact />
            <Money label="Compromise" value={f("27")} onChange={(v) => setF("27", v)} compact />
          </div>
        </div>
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
function TotalsBlock({ label, side }: { label: string; side?: BirForm1701ASide }) {
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-[10px] uppercase tracking-[.14em] text-content-muted">{label}</div>
      {[
        ["Tax due", side?.taxDue],
        ["Tax credits", side?.i64],
        ["Net tax payable", side?.i22],
        ["Penalties", side?.i28],
        ["Total payable", side?.i29],
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
