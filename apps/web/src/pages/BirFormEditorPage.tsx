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

/** Schedule-1 ATC codes the eBIRForms 2551Q supports (index order). */
const ATC_CODES = ["PT010", "PT040", "PT041", "PT060", "PT070", "PT090", "PT120", "PT130"];
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

interface Row {
  atc: string;
  taxable: string;
  rate: string;
}
const emptyRow = (): Row => ({ atc: "PT010", taxable: "", rate: "3" });

/** 2551Q (Quarterly Percentage Tax) authoring — create or edit, then export XML. */
export default function BirFormEditorPage() {
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
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [i15, setI15] = useState(""); // creditable percentage tax withheld
  const [i20, setI20] = useState(""); // surcharge
  const [i21, setI21] = useState(""); // interest
  const [i22, setI22] = useState(""); // compromise
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
    const dr = (d.rows as Row[] | undefined) ?? [];
    setRows(dr.length ? dr.map((r) => ({ atc: r.atc || "PT010", taxable: r.taxable || "", rate: r.rate || "" })) : [emptyRow()]);
    setI15(String(d.i15 ?? ""));
    setI20(String(d.i20 ?? ""));
    setI21(String(d.i21 ?? ""));
    setI22(String(d.i22 ?? ""));
  }, [existing.data]);

  const data = useMemo(
    () => ({
      year,
      periodType: "calendar",
      amended: "no",
      taxRelief: "no",
      itRate: "graduated",
      i15,
      i20,
      i21,
      i22,
      rows: rows.map((r) => ({ atc: r.atc, taxable: r.taxable, rate: r.rate })),
    }),
    [year, i15, i20, i21, i22, rows],
  );
  const period = `${year}-${quarter}`;

  // Live authoritative totals (server compute — the browser never computes tax).
  const [debounced, setDebounced] = useState(data);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(data), 350);
    return () => window.clearTimeout(t);
  }, [data]);
  const computed = useQuery({
    queryKey: ["bir-compute", debounced],
    queryFn: () => computeBirForm("2551Q", debounced),
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return createBirForm({ clientId, form: "2551Q", period, data });
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

  function updateRow(i: number, patch: Partial<Row>): void {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

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
        title={isNew ? "New 2551Q" : "2551Q"}
        eyebrow="BIR Forms · Quarterly Percentage Tax"
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

          {/* Schedule 1 — ATC rows */}
          <Card>
            <CardContent>
              <div className="eyebrow mb-2">Schedule 1 — Percentage tax</div>
              <div className="overflow-hidden rounded-card border border-line">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                      <th className="px-3 py-2.5 font-semibold">ATC</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Taxable amount</th>
                      <th className="w-24 px-3 py-2.5 text-right font-semibold">Rate %</th>
                      <th className="w-36 px-3 py-2.5 text-right font-semibold">Tax due</th>
                      <th className="w-10 px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-divider">
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">
                          <select
                            className="input w-full"
                            value={r.atc}
                            onChange={(e) => updateRow(i, { atc: e.target.value })}
                          >
                            {ATC_CODES.map((a) => (
                              <option key={a} value={a}>
                                {a}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            className="input w-full text-right font-mono tabular-nums"
                            value={r.taxable}
                            onChange={(e) => updateRow(i, { taxable: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.1"
                            className="input w-full text-right font-mono tabular-nums"
                            value={r.rate}
                            onChange={(e) => updateRow(i, { rate: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-content">
                          {peso(c?.rows?.[i]?.due ?? 0)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="px-2"
                            disabled={rows.length === 1}
                            onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                          >
                            ✕
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length < 6 ? (
                <div className="mt-3">
                  <Button variant="outline" size="sm" onClick={() => setRows((p) => [...p, emptyRow()])}>
                    + Add line
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Credits & penalties */}
          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-content">
                  Creditable percentage tax withheld (Item 15)
                </span>
                <input
                  type="number"
                  className="input w-full text-right font-mono"
                  value={i15}
                  onChange={(e) => setI15(e.target.value)}
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["Surcharge", i20, setI20] as const,
                  ["Interest", i21, setI21] as const,
                  ["Compromise", i22, setI22] as const,
                ].map(([label, val, set]) => (
                  <label key={label} className="block">
                    <span className="mb-1.5 block text-[12px] font-semibold text-content-secondary">
                      {label}
                    </span>
                    <input
                      type="number"
                      className="input w-full text-right font-mono"
                      value={val}
                      onChange={(e) => set(e.target.value)}
                    />
                  </label>
                ))}
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
                ["Total tax due", c?.i14],
                ["Total credits", c?.i18],
                ["Tax still payable", c?.i19],
                ["Total penalties", c?.i23],
              ].map(([label, v]) => (
                <div key={label as string} className="flex items-center justify-between">
                  <span className="text-[13px] text-content-secondary">{label}</span>
                  <span className="font-mono tabular-nums text-content">{peso(Number(v ?? 0))}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-line-strong pt-2">
                <span className="text-[13px] font-semibold text-navy">Total amount payable</span>
                <span className={cn("font-mono text-[15px] font-semibold tabular-nums text-navy")}>
                  {peso(Number(c?.i24 ?? 0))}
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            <Button disabled={!clientId || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : isNew ? "Save draft" : "Save changes"}
            </Button>
            {!isNew ? (
              <Button
                variant="outline"
                disabled={exportXml.isPending}
                onClick={() => exportXml.mutate()}
              >
                {exportXml.isPending ? "Exporting…" : "Export eBIRForms XML"}
              </Button>
            ) : (
              <p className="text-center text-[11.5px] text-content-muted">
                Save the draft to enable XML export.
              </p>
            )}
            {!isNew ? (
              isFiled ? (
                <Button
                  variant="ghost"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate("draft")}
                >
                  {setStatus.isPending ? "Reopening…" : "Reopen to draft"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate("filed")}
                >
                  {setStatus.isPending ? "Marking…" : "Mark as filed"}
                </Button>
              )
            ) : null}
          </div>

          {isFiled ? (
            <div className="rounded-card border border-success/40 bg-success-bg px-3.5 py-2.5 text-[12.5px] text-content">
              <span className="font-semibold">Filed.</span> These figures are now the{" "}
              <em>authoritative</em> percentage-tax numbers on this client&apos;s tax view.
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
