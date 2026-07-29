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
  type BirForm2316Computed,
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

/** Non-taxable / exempt compensation lines (items 29-37 → 38). */
const NON_TAXABLE: [key: string, label: string][] = [
  ["i29", "Basic salary (minimum wage earner)"],
  ["i30", "Holiday pay (MWE)"],
  ["i31", "Overtime pay (MWE)"],
  ["i32", "Night shift differential (MWE)"],
  ["i33", "Hazard pay (MWE)"],
  ["i34", "13th month pay and other benefits (max ₱90,000)"],
  ["i35", "De minimis benefits"],
  ["i36", "SSS, GSIS, PHIC, HDMF and union dues"],
  ["i37", "Other non-taxable compensation"],
];
/** Taxable REGULAR lines (items 39-44B). */
const REGULAR: [key: string, label: string][] = [
  ["i39", "Basic salary"],
  ["i40", "Representation"],
  ["i41", "Transportation"],
  ["i42", "Cost of living allowance (COLA)"],
  ["i43", "Fixed housing allowance"],
  ["i44A", "Other regular compensation (A)"],
  ["i44B", "Other regular compensation (B)"],
];
/** Taxable SUPPLEMENTARY lines (items 45-51B). */
const SUPPLEMENTARY: [key: string, label: string][] = [
  ["i45", "Commission"],
  ["i46", "Profit sharing"],
  ["i47", "Fees, including director's fees"],
  ["i48", "Taxable 13th month and other benefits"],
  ["i49", "Hazard pay"],
  ["i50", "Overtime pay"],
  ["i51A", "Other supplementary compensation (A)"],
  ["i51B", "Other supplementary compensation (B)"],
];
const OTHER_KEYS = ["i22", "i25A", "i25B", "i27"];
const ALL_KEYS = [
  ...NON_TAXABLE.map(([k]) => k),
  ...REGULAR.map(([k]) => k),
  ...SUPPLEMENTARY.map(([k]) => k),
  ...OTHER_KEYS,
];
type Fields = Record<string, string>;
const emptyFields = (): Fields => ALL_KEYS.reduce((o, k) => ({ ...o, [k]: "" }), {} as Fields);

/**
 * 2316 — Certificate of Compensation Payment / Tax Withheld.
 *
 * Issued to an *employee*, not e-filed, so there is no eBIRForms XML. The
 * deliverable is the printed certificate, produced here as an A4 PDF.
 */
export default function BirForm2316Editor() {
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
  // Employee — the party the certificate is issued to.
  const [empName, setEmpName] = useState("");
  const [empTin, setEmpTin] = useState("");
  const [empAddress, setEmpAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const clientQ = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchClient(clientId),
    enabled: !!clientId,
  });

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
    setEmpName(String(d.empName ?? ""));
    setEmpTin(String(d.empTin ?? ""));
    setEmpAddress(String(d.empAddress ?? ""));
  }, [existing.data]);

  const data = useMemo(() => {
    const base: Record<string, string> = { year, empName, empTin, empAddress };
    for (const k of ALL_KEYS) if (fields[k]) base[k] = fields[k]!;
    return base;
  }, [year, empName, empTin, empAddress, fields]);

  const [debounced, setDebounced] = useState(data);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(data), 350);
    return () => window.clearTimeout(t);
  }, [data]);
  const computed = useQuery({
    queryKey: ["bir-compute-2316", debounced],
    queryFn: () => computeBirForm<BirForm2316Computed>("2316", debounced),
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return createBirForm({ clientId, form: "2316", period: year, data });
      return updateBirForm(id!, { period: year, data });
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

  const sheetRef = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);
  async function printPdf() {
    const node = sheetRef.current;
    if (!node) return;
    setPrinting(true);
    setError(null);
    try {
      await sheetsToPdf([node], certificateFileName("2316", year, clientQ.data?.tin));
    } catch {
      setError("Could not produce the PDF — please retry.");
    } finally {
      setPrinting(false);
    }
  }

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
  const employer = clientQ.data;

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title={isNew ? "New 2316" : "2316"}
        eyebrow="BIR Forms · Certificate of Compensation Payment / Tax Withheld"
        actions={
          <Button variant="ghost" onClick={() => navigate("/bir-forms")}>
            Back
          </Button>
        }
      />

      <div className="mb-6 rounded-card border border-line bg-sidebar px-4 py-3 text-[12.5px] text-content-secondary">
        A 2316 is <span className="font-semibold text-content">issued to an employee</span>, not
        e-filed — BIR publishes no eBIRForms XML for it. This editor prints a faithful A4 PDF instead
        of exporting XML.
      </div>

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
                  <span className="mb-1.5 block text-[13px] font-semibold text-content">
                    Employer (client)
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
                  <span className="mb-1.5 block text-[13px] font-semibold text-content">
                    Calendar year
                  </span>
                  <input
                    className="input w-full font-mono"
                    value={year}
                    onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  />
                </label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Employee</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold text-content">Employee name</span>
                  <input className="input w-full" value={empName} onChange={(e) => setEmpName(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-semibold text-content">Employee TIN</span>
                  <input
                    className="input w-full font-mono"
                    value={empTin}
                    onChange={(e) => setEmpTin(e.target.value)}
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-semibold text-content">
                  Registered address
                </span>
                <input className="input w-full" value={empAddress} onChange={(e) => setEmpAddress(e.target.value)} />
              </label>
            </CardContent>
          </Card>

          <Section title="A. Non-taxable / exempt compensation (Items 29-37)" lines={NON_TAXABLE} fields={fields} set={set} total={["Total non-taxable (Item 38)", c?.i38]} />
          <Section title="B. Taxable compensation — regular (Items 39-44B)" lines={REGULAR} fields={fields} set={set} total={["Total regular", c?.reg]} />
          <Section title="Taxable compensation — supplementary (Items 45-51B)" lines={SUPPLEMENTARY} fields={fields} set={set} total={["Total supplementary", c?.supp]} />

          <Card>
            <CardContent className="space-y-3">
              <div className="eyebrow">Previous employer &amp; taxes withheld</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Money label="Taxable comp. from previous employer (Item 22)" value={fields.i22 ?? ""} onChange={(v) => set("i22", v)} />
                <Money label="Tax withheld — present employer (Item 25A)" value={fields.i25A ?? ""} onChange={(v) => set("i25A", v)} />
                <Money label="Tax withheld — previous employer (Item 25B)" value={fields.i25B ?? ""} onChange={(v) => set("i25B", v)} />
                <Money label="5% PERA tax credit (Item 27)" value={fields.i27 ?? ""} onChange={(v) => set("i27", v)} />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-2.5">
              <div className="eyebrow mb-1">Computed (authoritative)</div>
              {[
                ["Gross compensation (19)", c?.i19],
                ["Less: non-taxable (20)", c?.i20],
                ["Taxable, present (21)", c?.i21],
                ["Add: previous employer (22)", c?.i22],
                ["Gross taxable (23)", c?.i23],
                ["Tax due (24)", c?.i24],
                ["Total withheld as adjusted (26)", c?.i26],
              ].map(([label, v]) => (
                <div key={label as string} className="flex items-center justify-between">
                  <span className="text-[13px] text-content-secondary">{label}</span>
                  <span className="font-mono tabular-nums text-content">{peso(Number(v ?? 0))}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-line-strong pt-2">
                <span className="text-[13px] font-semibold text-navy">Total taxes withheld (28)</span>
                <span className={cn("font-mono text-[15px] font-semibold tabular-nums text-navy")}>
                  {peso(Number(c?.i28 ?? 0))}
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
              the employee.
            </div>
          ) : null}
        </div>
      </div>

      {/* Off-screen faithful sheet — the thing that becomes the PDF. */}
      <div className="bir-sheet-stage" aria-hidden="true">
        <div ref={sheetRef} className="bir-sheet">
          <Sheet2316
            year={year}
            employerName={employer?.businessName ?? ""}
            employerTin={employer?.tin ?? ""}
            employerAddress={[employer?.address, employer?.city].filter(Boolean).join(", ")}
            empName={empName}
            empTin={empTin}
            empAddress={empAddress}
            fields={fields}
            comp={c}
          />
        </div>
      </div>
    </div>
  );
}

/** A titled block of money lines with a computed total strip. */
function Section({
  title,
  lines,
  fields,
  set,
  total,
}: {
  title: string;
  lines: [key: string, label: string][];
  fields: Fields;
  set: (k: string, v: string) => void;
  total: [label: string, value: number | undefined];
}) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="eyebrow">{title}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {lines.map(([k, label]) => (
            <Money key={k} label={label} value={fields[k] ?? ""} onChange={(v) => set(k, v)} />
          ))}
        </div>
        <div className="flex items-center justify-between rounded-input bg-sidebar px-3 py-2 text-[12.5px]">
          <span className="text-content-secondary">{total[0]}</span>
          <span className="font-mono font-semibold tabular-nums text-navy">{peso(total[1] ?? 0)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/** The faithful printed 2316 sheet. */
function Sheet2316({
  year,
  employerName,
  employerTin,
  employerAddress,
  empName,
  empTin,
  empAddress,
  fields,
  comp,
}: {
  year: string;
  employerName: string;
  employerTin: string;
  employerAddress: string;
  empName: string;
  empTin: string;
  empAddress: string;
  fields: Fields;
  comp?: BirForm2316Computed;
}) {
  const money = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f = (k: string) => money(Number(fields[k]) || 0);
  const itemNo = (k: string) => k.replace(/^i/, "");

  const rowsFor = (lines: [string, string][]) =>
    lines.map(([k, label]) => (
      <tr key={k}>
        <td style={{ width: "8%", textAlign: "center" }} className="bir-item">
          {itemNo(k)}
        </td>
        <td>{label}</td>
        <td className="bir-num" style={{ width: "22%" }}>
          {f(k)}
        </td>
      </tr>
    ));

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ width: 90 }}>
          <div className="bir-sub">Republic of the Philippines</div>
          <div className="bir-sub">Department of Finance</div>
          <div className="bir-sub">Bureau of Internal Revenue</div>
        </div>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div className="bir-title">Certificate of Compensation</div>
          <div className="bir-title">Payment / Tax Withheld</div>
          <div className="bir-sub" style={{ marginTop: 2 }}>
            For Compensation Payment With or Without Tax Withheld
          </div>
        </div>
        <div style={{ width: 90, textAlign: "right" }}>
          <div className="bir-item">BIR Form No.</div>
          <div className="bir-title">2316</div>
        </div>
      </div>

      <table style={{ marginTop: 10 }}>
        <tbody>
          <tr>
            <td style={{ width: "22%" }}>
              <span className="bir-lbl">1 For the Year</span>
              <div style={{ fontFamily: "monospace" }}>{year}</div>
            </td>
            <td>
              <span className="bir-lbl">2 For the Period — From</span>
              <div>{`01/01/${year}`}</div>
            </td>
            <td>
              <span className="bir-lbl">To</span>
              <div>{`12/31/${year}`}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="bir-band" style={{ marginTop: 8 }}>
        Part I — Employee Information
      </div>
      <table>
        <tbody>
          <tr>
            <td style={{ width: "26%" }}>
              <span className="bir-lbl">3 Taxpayer Identification Number</span>
              <div style={{ fontFamily: "monospace" }}>{empTin || " "}</div>
            </td>
            <td>
              <span className="bir-lbl">4 Employee&apos;s Name</span>
              <div>{empName || " "}</div>
            </td>
          </tr>
          <tr>
            <td colSpan={2}>
              <span className="bir-lbl">5 Registered Address</span>
              <div>{empAddress || " "}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="bir-band" style={{ marginTop: 8 }}>
        Part II — Employer Information (Present)
      </div>
      <table>
        <tbody>
          <tr>
            <td style={{ width: "26%" }}>
              <span className="bir-lbl">Taxpayer Identification Number</span>
              <div style={{ fontFamily: "monospace" }}>{employerTin || " "}</div>
            </td>
            <td>
              <span className="bir-lbl">Employer&apos;s Name</span>
              <div>{employerName || " "}</div>
            </td>
          </tr>
          <tr>
            <td colSpan={2}>
              <span className="bir-lbl">Registered Address</span>
              <div>{employerAddress || " "}</div>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="bir-band" style={{ marginTop: 8 }}>
        Part IV-A — Summary
      </div>
      <table>
        <tbody>
          {[
            ["19", "Gross Compensation Income from Present Employer", comp?.i19],
            ["20", "Less: Total Non-Taxable / Exempt Compensation Income", comp?.i20],
            ["21", "Taxable Compensation Income from Present Employer", comp?.i21],
            ["22", "Add: Taxable Compensation from Previous Employer", comp?.i22],
            ["23", "Gross Taxable Compensation Income", comp?.i23],
            ["24", "Tax Due", comp?.i24],
            ["25A", "Amount of Taxes Withheld — Present Employer", comp?.i25A],
            ["25B", "Amount of Taxes Withheld — Previous Employer", comp?.i25B],
            ["26", "Total Amount of Taxes Withheld as adjusted", comp?.i26],
            ["27", "Add: 5% PERA Tax Credit", comp?.i27],
            ["28", "Total Taxes Withheld", comp?.i28],
          ].map(([no, label, v]) => (
            <tr key={no as string}>
              <td style={{ width: "8%", textAlign: "center" }} className="bir-item">
                {no}
              </td>
              <td>{label}</td>
              <td className="bir-num" style={{ width: "22%", fontWeight: no === "28" ? 700 : 400 }}>
                {money(Number(v ?? 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="bir-band" style={{ marginTop: 8 }}>
        Part IV-B — Details of Compensation Income
      </div>
      <table>
        <tbody>
          <tr>
            <td colSpan={3} style={{ fontWeight: 700, background: "#f4f4f4" }}>
              A. Non-Taxable / Exempt Compensation Income
            </td>
          </tr>
          {rowsFor(NON_TAXABLE)}
          <tr>
            <td className="bir-item" style={{ textAlign: "center" }}>
              38
            </td>
            <td style={{ fontWeight: 700 }}>Total Non-Taxable / Exempt Compensation Income</td>
            <td className="bir-num" style={{ fontWeight: 700 }}>
              {money(comp?.i38 ?? 0)}
            </td>
          </tr>
          <tr>
            <td colSpan={3} style={{ fontWeight: 700, background: "#f4f4f4" }}>
              B. Taxable Compensation Income — Regular
            </td>
          </tr>
          {rowsFor(REGULAR)}
          <tr>
            <td colSpan={3} style={{ fontWeight: 700, background: "#f4f4f4" }}>
              Supplementary
            </td>
          </tr>
          {rowsFor(SUPPLEMENTARY)}
          <tr>
            <td className="bir-item" style={{ textAlign: "center" }}>
              52
            </td>
            <td style={{ fontWeight: 700 }}>Total Taxable Compensation Income</td>
            <td className="bir-num" style={{ fontWeight: 700 }}>
              {money(comp?.i52 ?? 0)}
            </td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 18, display: "flex", gap: 26 }}>
        <div style={{ flex: 1 }}>
          <div style={{ borderTop: "1px solid #000", paddingTop: 3 }} className="bir-lbl">
            Signature over Printed Name of Authorized Representative (Employer)
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ borderTop: "1px solid #000", paddingTop: 3 }} className="bir-lbl">
            Signature over Printed Name of Employee
          </div>
        </div>
      </div>
    </>
  );
}

/** A single labelled peso input. */
function Money({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-content">{label}</span>
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
