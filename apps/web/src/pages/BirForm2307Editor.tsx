import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ApiError,
  computeBirForm,
  createBirForm,
  fetchBirForm,
  fetchClient,
  fetchClients,
  updateBirForm,
  type BirForm2307Computed,
  type ClientSummary,
} from "../lib/api";
import { certificateFileName, sheetsToPdf } from "../lib/sheetPdf";
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
/** Common creditable-withholding ATCs for income payments (2307 Part III). */
const ATC_CODES = ["WI010", "WI011", "WI020", "WI070", "WI100", "WI139", "WI158", "WC010", "WC100", "WC158"];

interface Row {
  atc: string;
  desc: string;
  m1: string;
  m2: string;
  m3: string;
  tax: string;
}
const emptyRow = (): Row => ({ atc: "WI010", desc: "", m1: "", m2: "", m3: "", tax: "" });

/**
 * 2307 — Certificate of Creditable Tax Withheld at Source.
 *
 * Unlike the seven returns, a 2307 is *issued* to a payee rather than e-filed,
 * so there is no eBIRForms XML. The deliverable is the printed certificate:
 * this editor renders a faithful A4 sheet and prints it to PDF.
 */
export default function BirForm2307Editor() {
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
  // Payee — the party the certificate is issued TO.
  const [payeeName, setPayeeName] = useState("");
  const [payeeTin, setPayeeTin] = useState("");
  const [payeeAddress, setPayeeAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The withholding agent is the client (the payor issuing the certificate).
  const clientQ = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchClient(clientId),
    enabled: !!clientId,
  });

  useEffect(() => {
    const d = existing.data?.data as Record<string, unknown> | undefined;
    if (!d) return;
    setClientId(existing.data!.clientId);
    const m = /^(\d{4})-(Q[1-4])$/.exec(existing.data!.period || "");
    if (m) {
      setYear(m[1]!);
      setQuarter(m[2]!);
    }
    const dr = (d.rows as Row[] | undefined) ?? [];
    setRows(
      dr.length
        ? dr.map((r) => ({
            atc: r.atc || "WI010",
            desc: r.desc || "",
            m1: r.m1 || "",
            m2: r.m2 || "",
            m3: r.m3 || "",
            tax: r.tax || "",
          }))
        : [emptyRow()],
    );
    setPayeeName(String(d.payeeName ?? ""));
    setPayeeTin(String(d.payeeTin ?? ""));
    setPayeeAddress(String(d.payeeAddress ?? ""));
  }, [existing.data]);

  const data = useMemo(
    () => ({
      year,
      quarter: quarter.replace("Q", ""),
      payeeName,
      payeeTin,
      payeeAddress,
      rows: rows.map((r) => ({ ...r })),
    }),
    [year, quarter, payeeName, payeeTin, payeeAddress, rows],
  );
  const period = `${year}-${quarter}`;

  const [debounced, setDebounced] = useState(data);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(data), 350);
    return () => window.clearTimeout(t);
  }, [data]);
  const computed = useQuery({
    queryKey: ["bir-compute-2307", debounced],
    queryFn: () => computeBirForm<BirForm2307Computed>("2307", debounced),
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return createBirForm({ clientId, form: "2307", period, data });
      return updateBirForm(id!, { period, data });
    },
    onSuccess: (form) => {
      setError(null);
      if (isNew) navigate(`/bir-forms/${form.id}`);
      else void existing.refetch();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not save the form."),
  });

  const setStatus = useMutation({
    mutationFn: (status: "draft" | "filed") => updateBirForm(id!, { status }),
    onSuccess: () => {
      setError(null);
      void existing.refetch();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Could not update the form status."),
  });

  // ---- Print to PDF (the certificate's only output) ----
  const sheetRef = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);
  async function printPdf() {
    const node = sheetRef.current;
    if (!node) return;
    setPrinting(true);
    setError(null);
    try {
      await sheetsToPdf([node], certificateFileName("2307", period, clientQ.data?.tin));
    } catch {
      setError("Could not produce the PDF — please retry.");
    } finally {
      setPrinting(false);
    }
  }

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
  const agent = clientQ.data;

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title={isNew ? "New 2307" : "2307"}
        eyebrow="BIR Forms · Certificate of Creditable Tax Withheld"
        actions={
          <Button variant="ghost" onClick={() => navigate("/bir-forms")}>
            Back
          </Button>
        }
      />

      <div className="mb-6 rounded-card border border-line bg-sidebar px-4 py-3 text-[12.5px] text-content-secondary">
        A 2307 is <span className="font-semibold text-content">issued to a payee</span>, not e-filed —
        BIR publishes no eBIRForms XML for it. The deliverable is the printed certificate, so this
        editor prints a faithful A4 PDF instead of exporting XML.
      </div>

      {error ? (
        <div className="mb-5 rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* Withholding agent + period */}
          <Card>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-4">
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-[13px] font-semibold text-content">
                    Withholding agent (client)
                  </span>
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
            </CardContent>
          </Card>

          {/* Payee */}
          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Payee — who this certificate is issued to</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold text-content">Payee name</span>
                  <input className="input w-full" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold text-content">Payee TIN</span>
                  <input
                    className="input w-full font-mono"
                    value={payeeTin}
                    onChange={(e) => setPayeeTin(e.target.value)}
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-content">
                  Registered address
                </span>
                <input
                  className="input w-full"
                  value={payeeAddress}
                  onChange={(e) => setPayeeAddress(e.target.value)}
                />
              </label>
            </CardContent>
          </Card>

          {/* Income payments */}
          <Card>
            <CardContent>
              <div className="eyebrow mb-2">Income payments subject to withholding</div>
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-line bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                      <th className="px-3 py-2.5 font-semibold">ATC</th>
                      <th className="px-3 py-2.5 text-right font-semibold">1st month</th>
                      <th className="px-3 py-2.5 text-right font-semibold">2nd month</th>
                      <th className="px-3 py-2.5 text-right font-semibold">3rd month</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Tax withheld</th>
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
                        {(["m1", "m2", "m3"] as const).map((k) => (
                          <td key={k} className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              className="input w-full text-right font-mono tabular-nums"
                              value={r[k]}
                              onChange={(e) => updateRow(i, { [k]: e.target.value })}
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-content">
                          {peso(c?.rows?.[i]?.total ?? 0)}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            className="input w-full text-right font-mono tabular-nums"
                            value={r.tax}
                            onChange={(e) => updateRow(i, { tax: e.target.value })}
                          />
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
              {rows.length < 8 ? (
                <div className="mt-3">
                  <Button variant="outline" size="sm" onClick={() => setRows((p) => [...p, emptyRow()])}>
                    + Add line
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* Totals + actions */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-2.5">
              <div className="eyebrow mb-1">Computed (authoritative)</div>
              {[
                ["1st month", c?.tM1],
                ["2nd month", c?.tM2],
                ["3rd month", c?.tM3],
                ["Total income payments", c?.totalIncome],
              ].map(([label, v]) => (
                <div key={label as string} className="flex items-center justify-between">
                  <span className="text-[13px] text-content-secondary">{label}</span>
                  <span className="font-mono tabular-nums text-content">{peso(Number(v ?? 0))}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-line-strong pt-2">
                <span className="text-[13px] font-semibold text-navy">Total tax withheld</span>
                <span className={cn("font-mono text-[15px] font-semibold tabular-nums text-navy")}>
                  {peso(Number(c?.totalTax ?? 0))}
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            <Button disabled={!clientId || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : isNew ? "Save draft" : "Save changes"}
            </Button>
            <Button variant="outline" disabled={!clientId || printing} onClick={() => void printPdf()}>
              {printing ? "Preparing PDF…" : "Print certificate (PDF)"}
            </Button>
            {!isNew ? (
              isFiled ? (
                <Button variant="ghost" disabled={setStatus.isPending} onClick={() => setStatus.mutate("draft")}>
                  {setStatus.isPending ? "Reopening…" : "Reopen to draft"}
                </Button>
              ) : (
                <Button variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate("filed")}>
                  {setStatus.isPending ? "Marking…" : "Mark as issued"}
                </Button>
              )
            ) : null}
          </div>

          {isFiled ? (
            <div className="rounded-card border border-success/40 bg-success-bg px-3.5 py-2.5 text-[12.5px] text-content">
              <span className="font-semibold">Issued.</span> This certificate is recorded as handed to
              the payee.
            </div>
          ) : null}
        </div>
      </div>

      {/* Off-screen faithful sheet — the thing that becomes the PDF. */}
      <div className="bir-sheet-stage" aria-hidden="true">
        <div ref={sheetRef} className="bir-sheet">
          <Sheet2307
            year={year}
            quarter={quarter}
            agentName={agent?.businessName ?? ""}
            agentTin={agent?.tin ?? ""}
            agentAddress={[agent?.address, agent?.city].filter(Boolean).join(", ")}
            payeeName={payeeName}
            payeeTin={payeeTin}
            payeeAddress={payeeAddress}
            rows={rows}
            comp={c}
          />
        </div>
      </div>
    </div>
  );
}

/** The faithful printed 2307 sheet. Plain black-on-white, A4 at 96dpi. */
function Sheet2307({
  year,
  quarter,
  agentName,
  agentTin,
  agentAddress,
  payeeName,
  payeeTin,
  payeeAddress,
  rows,
  comp,
}: {
  year: string;
  quarter: string;
  agentName: string;
  agentTin: string;
  agentAddress: string;
  payeeName: string;
  payeeTin: string;
  payeeAddress: string;
  rows: Row[];
  comp?: BirForm2307Computed;
}) {
  const qn = Number(quarter.replace("Q", "")) || 1;
  const periods: Record<number, [string, string]> = {
    1: ["01/01", "03/31"],
    2: ["04/01", "06/30"],
    3: ["07/01", "09/30"],
    4: ["10/01", "12/31"],
  };
  const [from, to] = periods[qn] ?? periods[1]!;
  const money = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ width: 90 }}>
          <div className="bir-sub">Republic of the Philippines</div>
          <div className="bir-sub">Department of Finance</div>
          <div className="bir-sub">Bureau of Internal Revenue</div>
        </div>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div className="bir-title">Certificate of Creditable Tax</div>
          <div className="bir-title">Withheld at Source</div>
        </div>
        <div style={{ width: 90, textAlign: "right" }}>
          <div className="bir-item">BIR Form No.</div>
          <div className="bir-title">2307</div>
        </div>
      </div>

      <table style={{ marginTop: 10 }}>
        <tbody>
          <tr>
            <td style={{ width: "18%" }}>
              <span className="bir-lbl">1 For the Period From</span>
              <div>{`${from}/${year}`}</div>
            </td>
            <td style={{ width: "18%" }}>
              <span className="bir-lbl">To</span>
              <div>{`${to}/${year}`}</div>
            </td>
            <td>
              <span className="bir-lbl">Quarter</span>
              <div>{`${qn}${qn === 1 ? "st" : qn === 2 ? "nd" : qn === 3 ? "rd" : "th"} Quarter ${year}`}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="bir-band" style={{ marginTop: 8 }}>
        Part I — Payee Information
      </div>
      <table>
        <tbody>
          <tr>
            <td style={{ width: "26%" }}>
              <span className="bir-lbl">2 Taxpayer Identification Number</span>
              <div style={{ fontFamily: "monospace" }}>{payeeTin || " "}</div>
            </td>
            <td>
              <span className="bir-lbl">3 Payee&apos;s Name</span>
              <div>{payeeName || " "}</div>
            </td>
          </tr>
          <tr>
            <td colSpan={2}>
              <span className="bir-lbl">4 Registered Address</span>
              <div>{payeeAddress || " "}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="bir-band" style={{ marginTop: 8 }}>
        Part II — Withholding Agent Information
      </div>
      <table>
        <tbody>
          <tr>
            <td style={{ width: "26%" }}>
              <span className="bir-lbl">5 Taxpayer Identification Number</span>
              <div style={{ fontFamily: "monospace" }}>{agentTin || " "}</div>
            </td>
            <td>
              <span className="bir-lbl">6 Withholding Agent&apos;s Name</span>
              <div>{agentName || " "}</div>
            </td>
          </tr>
          <tr>
            <td colSpan={2}>
              <span className="bir-lbl">7 Registered Address</span>
              <div>{agentAddress || " "}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="bir-band" style={{ marginTop: 8 }}>
        Part III — Details of Monthly Income Payments and Taxes Withheld
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: "34%" }}>Income Payments Subject to Expanded Withholding Tax</th>
            <th style={{ width: "10%" }}>ATC</th>
            <th>1st Month</th>
            <th>2nd Month</th>
            <th>3rd Month</th>
            <th>Total</th>
            <th>Tax Withheld</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.desc || " "}</td>
              <td style={{ textAlign: "center" }}>{r.atc}</td>
              <td className="bir-num">{money(Number(r.m1) || 0)}</td>
              <td className="bir-num">{money(Number(r.m2) || 0)}</td>
              <td className="bir-num">{money(Number(r.m3) || 0)}</td>
              <td className="bir-num">{money(comp?.rows?.[i]?.total ?? 0)}</td>
              <td className="bir-num">{money(Number(r.tax) || 0)}</td>
            </tr>
          ))}
          {/* Pad to a stable sheet height so short certificates still fill the form. */}
          {Array.from({ length: Math.max(0, 8 - rows.length) }).map((_, i) => (
            <tr key={`pad-${i}`}>
              <td>&nbsp;</td>
              <td>&nbsp;</td>
              <td>&nbsp;</td>
              <td>&nbsp;</td>
              <td>&nbsp;</td>
              <td>&nbsp;</td>
              <td>&nbsp;</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2} style={{ fontWeight: 700, textAlign: "right" }}>
              Total
            </td>
            <td className="bir-num" style={{ fontWeight: 700 }}>
              {money(comp?.tM1 ?? 0)}
            </td>
            <td className="bir-num" style={{ fontWeight: 700 }}>
              {money(comp?.tM2 ?? 0)}
            </td>
            <td className="bir-num" style={{ fontWeight: 700 }}>
              {money(comp?.tM3 ?? 0)}
            </td>
            <td className="bir-num" style={{ fontWeight: 700 }}>
              {money(comp?.totalIncome ?? 0)}
            </td>
            <td className="bir-num" style={{ fontWeight: 700 }}>
              {money(comp?.totalTax ?? 0)}
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 22, display: "flex", gap: 26 }}>
        <div style={{ flex: 1 }}>
          <div style={{ borderTop: "1px solid #000", paddingTop: 3 }} className="bir-lbl">
            Signature over Printed Name of Payor / Authorized Representative
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ borderTop: "1px solid #000", paddingTop: 3 }} className="bir-lbl">
            Signature over Printed Name of Payee / Authorized Representative
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, fontSize: 7.5 }}>
        We declare, under the penalties of perjury, that this certificate has been made in good faith,
        verified by us, and to the best of our knowledge and belief, is true and correct, pursuant to
        the provisions of the National Internal Revenue Code, as amended, and the regulations issued
        under authority thereof.
      </div>
    </>
  );
}
