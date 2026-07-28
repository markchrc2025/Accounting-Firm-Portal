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
  type BirForm2550QComputed,
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

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

/** The numeric Part IV / Part II fields the 2550Q editor captures (all peso strings). */
const FIELD_KEYS = [
  // Output side
  "i31a", "i32a", "i33a", "i35b", "i36b",
  // Input tax carried over
  "i38", "i39", "i40", "i41", "i42",
  // Current transactions (a = purchase, b = input tax)
  "i44a", "i44b", "i45a", "i45b", "i46a", "i46b", "i47a", "i47b", "i48a", "i49a",
  // Deductions / adjustments
  "i52", "i53", "i54", "i55", "i56", "i58",
  // Part II credits + penalties
  "i16", "i17", "i18", "i19", "i22", "i23", "i24",
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];
type Fields = Record<FieldKey, string>;
const emptyFields = (): Fields =>
  FIELD_KEYS.reduce((o, k) => ({ ...o, [k]: "" }), {} as Fields);

/** 2550Q (Quarterly VAT) authoring — create or edit, then export XML. */
export default function BirForm2550QEditor() {
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
  const [error, setError] = useState<string | null>(null);

  // Hydrate from an existing form.
  useEffect(() => {
    const d = existing.data?.data as Record<string, unknown> | undefined;
    if (!d) return;
    setClientId(existing.data!.clientId);
    const period = existing.data!.period || "";
    const m = /^(\d{4})-(Q[1-4])$/.exec(period);
    if (m) {
      setYear(m[1]!);
      setQuarter(m[2]!);
    }
    setFields((prev) => {
      const next = { ...prev };
      for (const k of FIELD_KEYS) if (d[k] != null) next[k] = String(d[k]);
      return next;
    });
  }, [existing.data]);

  const data = useMemo(
    () => ({
      year,
      periodType: "calendar",
      amended: "no",
      ...fields,
    }),
    [year, fields],
  );
  const period = `${year}-${quarter}`;

  // Live authoritative totals (server compute — the browser never computes tax).
  const [debounced, setDebounced] = useState(data);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(data), 350);
    return () => window.clearTimeout(t);
  }, [data]);
  const computed = useQuery({
    queryKey: ["bir-compute-2550q", debounced],
    queryFn: () => computeBirForm<BirForm2550QComputed>("2550Q", debounced),
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return createBirForm({ clientId, form: "2550Q", period, data });
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
        title={isNew ? "New 2550Q" : "2550Q"}
        eyebrow="BIR Forms · Quarterly Value-Added Tax"
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
                <label className="sm:col-span-1 block">
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
                  <select
                    className="input w-full"
                    value={quarter}
                    onChange={(e) => setQuarter(e.target.value)}
                  >
                    {QUARTERS.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </CardContent>
          </Card>

          {/* Output tax (Part IV, 31-37) */}
          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Output tax — sales for the quarter</div>
              <MoneyField label="VATable sales (net) — Item 31A" value={fields.i31a} onChange={(v) => set("i31a", v)} />
              <div className="flex items-center justify-between rounded-input bg-sidebar px-3 py-2">
                <span className="text-[12.5px] text-content-secondary">Output tax (12% of 31A) — Item 31B</span>
                <span className="font-mono text-[13px] font-semibold tabular-nums text-navy">{peso(c?.i31b ?? 0)}</span>
              </div>
              <MoneyField label="Zero-rated sales — Item 32A" value={fields.i32a} onChange={(v) => set("i32a", v)} />
              <MoneyField label="VAT-exempt sales — Item 33A" value={fields.i33a} onChange={(v) => set("i33a", v)} />
              <div className="grid gap-3 sm:grid-cols-2">
                <MoneyField label="Less: output tax on uncollectible — Item 35B" value={fields.i35b} onChange={(v) => set("i35b", v)} />
                <MoneyField label="Add: output tax on recovered — Item 36B" value={fields.i36b} onChange={(v) => set("i36b", v)} />
              </div>
            </CardContent>
          </Card>

          {/* Input tax carried over (38-43) */}
          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Input tax carried over</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <MoneyField label="Carried over, prev. quarter — Item 38" value={fields.i38} onChange={(v) => set("i38", v)} />
                <MoneyField label="Deferred input tax (capital goods) — Item 39" value={fields.i39} onChange={(v) => set("i39", v)} />
                <MoneyField label="Transitional input tax — Item 40" value={fields.i40} onChange={(v) => set("i40", v)} />
                <MoneyField label="Presumptive input tax — Item 41" value={fields.i41} onChange={(v) => set("i41", v)} />
                <MoneyField label="Other — Item 42" value={fields.i42} onChange={(v) => set("i42", v)} />
              </div>
            </CardContent>
          </Card>

          {/* Current transactions (44-51) */}
          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Current purchases — input tax</div>
              <PurchasePair label="Domestic — goods (Item 44)" a={fields.i44a} b={fields.i44b} onA={(v) => set("i44a", v)} onB={(v) => set("i44b", v)} />
              <PurchasePair label="Domestic — services (Item 45)" a={fields.i45a} b={fields.i45b} onA={(v) => set("i45a", v)} onB={(v) => set("i45b", v)} />
              <PurchasePair label="Importation — goods (Item 46)" a={fields.i46a} b={fields.i46b} onA={(v) => set("i46a", v)} onB={(v) => set("i46b", v)} />
              <PurchasePair label="Others (Item 47)" a={fields.i47a} b={fields.i47b} onA={(v) => set("i47a", v)} onB={(v) => set("i47b", v)} />
              <div className="grid gap-3 sm:grid-cols-2">
                <MoneyField label="Purchases not qualified for input tax — Item 48A" value={fields.i48a} onChange={(v) => set("i48a", v)} />
                <MoneyField label="VAT-exempt importations — Item 49A" value={fields.i49a} onChange={(v) => set("i49a", v)} />
              </div>
            </CardContent>
          </Card>

          {/* Deductions / adjustments (52-59) */}
          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Deductions from input tax</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <MoneyField label="Input tax on capital goods deferred — Item 52" value={fields.i52} onChange={(v) => set("i52", v)} />
                <MoneyField label="Input tax on VAT-exempt sales — Item 53" value={fields.i53} onChange={(v) => set("i53", v)} />
                <MoneyField label="VAT refund/TCC claimed — Item 54" value={fields.i54} onChange={(v) => set("i54", v)} />
                <MoneyField label="Input tax on unpaid purchases — Item 55" value={fields.i55} onChange={(v) => set("i55", v)} />
                <MoneyField label="Other — Item 56" value={fields.i56} onChange={(v) => set("i56", v)} />
                <MoneyField label="Add: input tax adjustment — Item 58" value={fields.i58} onChange={(v) => set("i58", v)} />
              </div>
            </CardContent>
          </Card>

          {/* Part II credits + penalties */}
          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Credits &amp; penalties (Part II)</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <MoneyField label="Creditable VAT withheld — Item 16" value={fields.i16} onChange={(v) => set("i16", v)} />
                <MoneyField label="Advance VAT payments — Item 17" value={fields.i17} onChange={(v) => set("i17", v)} />
                <MoneyField label="VAT paid on prior return — Item 18" value={fields.i18} onChange={(v) => set("i18", v)} />
                <MoneyField label="Other credits — Item 19" value={fields.i19} onChange={(v) => set("i19", v)} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <MoneyField label="Surcharge" value={fields.i22} onChange={(v) => set("i22", v)} compact />
                <MoneyField label="Interest" value={fields.i23} onChange={(v) => set("i23", v)} compact />
                <MoneyField label="Compromise" value={fields.i24} onChange={(v) => set("i24", v)} compact />
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
                ["Output tax due", c?.i34b],
                ["Total available input tax", c?.i51],
                ["Allowable input tax", c?.i60],
                ["Net VAT payable", c?.i61],
                ["Total tax credits", c?.i20],
                ["Total penalties", c?.i25],
              ].map(([label, v]) => (
                <div key={label as string} className="flex items-center justify-between">
                  <span className="text-[13px] text-content-secondary">{label}</span>
                  <span className="font-mono tabular-nums text-content">{peso(Number(v ?? 0))}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-line-strong pt-2">
                <span className="text-[13px] font-semibold text-navy">Total amount payable</span>
                <span className={cn("font-mono text-[15px] font-semibold tabular-nums text-navy")}>
                  {peso(Number(c?.i26 ?? 0))}
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
              <em>authoritative</em> VAT numbers on this client&apos;s tax view.
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

/** A single labelled peso input. */
function MoneyField({
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

/** A purchase line: net amount (A) + its input tax (B). */
function PurchasePair({
  label,
  a,
  b,
  onA,
  onB,
}: {
  label: string;
  a: string;
  b: string;
  onA: (v: string) => void;
  onB: (v: string) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-semibold text-content">{label}</span>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          min={0}
          placeholder="Net amount"
          className="input w-full text-right font-mono tabular-nums"
          value={a}
          onChange={(e) => onA(e.target.value)}
        />
        <input
          type="number"
          min={0}
          placeholder="Input tax"
          className="input w-full text-right font-mono tabular-nums"
          value={b}
          onChange={(e) => onB(e.target.value)}
        />
      </div>
    </div>
  );
}
