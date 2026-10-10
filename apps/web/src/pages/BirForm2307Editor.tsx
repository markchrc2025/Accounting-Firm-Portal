import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { FormViewShell, type FormViewMode } from "../components/birform/FormViewShell";
import { downloadSheetsPdf, type PagePt } from "../components/birform/sheetsPdf";
import { Form2307, type Form2307Signatory } from "../components/birform/Form2307";
import { tin14 } from "../components/birform/format";
import { FiledBanner, FiledFormAction } from "../components/birform/FiledFormPanel";
import { printParty } from "../lib/birFiling";
import {
  issueBlockers,
  type IssueBlocker,
  PAYEE_BRANCH_CHOICES,
  payeeBranchChoice,
  payeeBranchFrom,
  type PayeeBranchChoice,
} from "../lib/certificateRules";
import "../styles/bir-form.css";
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

/** BIR Form 2307 is printed on LONG BOND, 8.5 x 13 in = 612 x 936 pt (R1). */
const LONG_BOND_PT: PagePt = [612, 936];

/** Calendar bounds of each quarter, MM/DD — item 1 From and To. */
const QUARTER_BOUNDS: Record<number, [string, string]> = {
  1: ["01/01", "03/31"],
  2: ["04/01", "06/30"],
  3: ["07/01", "09/30"],
  4: ["10/01", "12/31"],
};

/** The six per-certificate signatory fields, as they live in dataJson. */
const SIGNATORY_KEYS = [
  "Name",
  "Title",
  "Tin",
  "TaxAgentNo",
  "TaxAgentIssued",
  "TaxAgentExpiry",
] as const;
type SignatoryKey = (typeof SIGNATORY_KEYS)[number];
type SignatoryState = Record<SignatoryKey, string>;
const emptySignatory = (): SignatoryState => ({
  Name: "",
  Title: "",
  Tin: "",
  TaxAgentNo: "",
  TaxAgentIssued: "",
  TaxAgentExpiry: "",
});
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
/** A new row has no ATC: the accountant selects one (W3 R6). */
const emptyRow = (): Row => ({ atc: "", desc: "", m1: "", m2: "", m3: "", tax: "" });

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
  // "Issue a corrected certificate" (W3 R2) opens a NEW certificate pre-filled
  // from an issued one. Nothing links the two: the new one is saved as any new
  // certificate is, and the old one stays issued.
  const [params] = useSearchParams();
  const correctFrom = isNew ? params.get("correctFrom") : null;
  const source = useQuery({
    queryKey: ["bir-form", correctFrom],
    queryFn: () => fetchBirForm(correctFrom!),
    enabled: !!correctFrom,
  });

  const [clientId, setClientId] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [quarter, setQuarter] = useState("Q1");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  // Payee — the party the certificate is issued TO.
  const [payeeName, setPayeeName] = useState("");
  const [payeeTin, setPayeeTin] = useState("");
  const [payeeAddress, setPayeeAddress] = useState("");
  // New in W2 pass 2 — boxes the official form carries that the hand-written
  // sheet omitted. Optional; blank when empty (R7).
  const [payeeZip, setPayeeZip] = useState("");
  const [payeeForeignAddress, setPayeeForeignAddress] = useState("");
  // The payee's branch code is required (W3 R4): head office is a choice the
  // accountant confirms, never a default.
  const [payeeBranchSel, setPayeeBranchSel] = useState<PayeeBranchChoice>("");
  const [payeeBranchTyped, setPayeeBranchTyped] = useState("");
  const payeeBranch = payeeBranchFrom(payeeBranchSel, payeeBranchTyped);
  const [payorSig, setPayorSig] = useState<SignatoryState>(emptySignatory);
  const [payeeSig, setPayeeSig] = useState<SignatoryState>(emptySignatory);
  const [mode, setMode] = useState<FormViewMode>("guided");
  const [error, setError] = useState<string | null>(null);

  // The withholding agent is the client (the payor issuing the certificate).
  // Once the certificate is issued with its filing snapshot, the print reads
  // the payor from the snapshot (W3 R3) and the client record is not read.
  const sealedSnapshot =
    existing.data?.status === "filed" && !!existing.data.filedSnapshot;
  const clientQ = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchClient(clientId),
    enabled: !!clientId && !sealedSnapshot,
  });

  // Only an ISSUED certificate of the same form is corrected (R2).
  const usableSource =
    source.data?.form === "2307" && source.data.status === "filed"
      ? source.data
      : undefined;
  const seed = existing.data ?? usableSource;
  useEffect(() => {
    const d = seed?.data as Record<string, unknown> | undefined;
    if (!d) return;
    setClientId(seed!.clientId);
    const m = /^(\d{4})-(Q[1-4])$/.exec(seed!.period || "");
    if (m) {
      setYear(m[1]!);
      setQuarter(m[2]!);
    }
    const dr = (d.rows as Row[] | undefined) ?? [];
    setRows(
      dr.length
        ? dr.map((r) => ({
            atc: r.atc || "",
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
    setPayeeZip(String(d.payeeZip ?? ""));
    setPayeeForeignAddress(String(d.payeeForeignAddress ?? ""));
    const branch = payeeBranchChoice(String(d.payeeBranch ?? ""));
    setPayeeBranchSel(branch.choice);
    setPayeeBranchTyped(branch.typed);
    const readSig = (prefix: "payor" | "payee"): SignatoryState => {
      const out = emptySignatory();
      for (const k of SIGNATORY_KEYS) {
        out[k] = String(d[`${prefix}Signatory${k}`] ?? d[`${prefix}${k}`] ?? "");
      }
      return out;
    };
    setPayorSig(readSig("payor"));
    setPayeeSig(readSig("payee"));
  }, [seed]);

  const data = useMemo(
    () => ({
      year,
      quarter: quarter.replace("Q", ""),
      payeeName,
      payeeTin,
      payeeAddress,
      payeeZip,
      payeeForeignAddress,
      payeeBranch,
      payorSignatoryName: payorSig.Name,
      payorSignatoryTitle: payorSig.Title,
      payorSignatoryTin: payorSig.Tin,
      payorTaxAgentNo: payorSig.TaxAgentNo,
      payorTaxAgentIssued: payorSig.TaxAgentIssued,
      payorTaxAgentExpiry: payorSig.TaxAgentExpiry,
      payeeSignatoryName: payeeSig.Name,
      payeeSignatoryTitle: payeeSig.Title,
      payeeSignatoryTin: payeeSig.Tin,
      payeeTaxAgentNo: payeeSig.TaxAgentNo,
      payeeTaxAgentIssued: payeeSig.TaxAgentIssued,
      payeeTaxAgentExpiry: payeeSig.TaxAgentExpiry,
      rows: rows.map((r) => ({ ...r })),
    }),
    [
      year,
      quarter,
      payeeName,
      payeeTin,
      payeeAddress,
      payeeZip,
      payeeForeignAddress,
      payeeBranch,
      payorSig,
      payeeSig,
      rows,
    ],
  );
  const period = `${year}-${quarter}`;

  // An existing form is computed only once it is hydrated: its first, empty
  // state is never sent, so a freshly mounted form (after Mark as filed, an
  // Amend, Back) never flashes zero totals; the stored figures show until
  // the live compute returns (W3).
  const [debounced, setDebounced] = useState<typeof data | null>(isNew ? data : null);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(data), 350);
    return () => window.clearTimeout(t);
  }, [data]);
  const computed = useQuery({
    queryKey: ["bir-compute-2307", debounced],
    queryFn: () => computeBirForm<BirForm2307Computed>("2307", debounced!),
    staleTime: Infinity,
    enabled: debounced !== null,
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
  /** The NEW replica's `.bir-doc` root — long bond, built from the official form. */
  const docRef = useRef<HTMLDivElement>(null);
  /** The hand-written A4 sheet, kept behind "Print (legacy)" until W4. */
  const legacySheetRef = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);
  const [printingLegacy, setPrintingLegacy] = useState(false);
  const party = printParty(existing.data, clientQ.data);
  const pdfName = certificateFileName("2307", period, party.tin);

  async function printPdf() {
    const node = docRef.current;
    if (!node) return;
    setPrinting(true);
    setError(null);
    try {
      await downloadSheetsPdf(node, LONG_BOND_PT, pdfName);
    } catch {
      setError("Could not produce the PDF — please retry.");
    } finally {
      setPrinting(false);
    }
  }

  /** The pre-pass-2 path: the hand-written sheet, rasterised onto A4 through
   *  the shared, fixed capture (W3 R5). Kept until W4 so a person can print
   *  both and compare them on paper. */
  async function printLegacyPdf() {
    const node = legacySheetRef.current;
    if (!node) return;
    setPrintingLegacy(true);
    setError(null);
    try {
      await sheetsToPdf([node], `legacy-${pdfName}`);
    } catch {
      setError("Could not produce the legacy PDF — please retry.");
    } finally {
      setPrintingLegacy(false);
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
  const c =
    computed.data ??
    (existing.data?.computed as typeof computed.data | null | undefined) ??
    undefined;
  const isFiled = existing.data?.status === "filed";
  // What stops a draft from being issued (W3 R4, R6). Issuing records the
  // SAVED certificate, so the rules are checked on what is saved; the screen is
  // used only to say "save first" when it already meets a rule the saved
  // certificate does not.
  const saved = (existing.data?.data ?? {}) as Record<string, unknown>;
  const gate: IssueBlocker[] =
    isFiled || isNew
      ? []
      : issueBlockers({
          payorKnown: !!clientQ.data,
          payorLoadFailed: clientQ.isError,
          payorBranch: party.branch,
          payeeBranch: String(saved.payeeBranch ?? ""),
          payeeTin: String(saved.payeeTin ?? ""),
          rows: (saved.rows as Row[] | undefined) ?? [],
        });
  const onScreen = issueBlockers({
    payorBranch: party.branch,
    payeeBranch,
    payeeTin,
    rows,
  });
  // Payee rules are one family: a screen that breaks a DIFFERENT payee rule
  // does not "meet" the saved one.
  const family = (r: IssueBlocker["rule"]) => (r.startsWith("payee") ? "payee" : r);
  const blockers = gate.map((b) =>
    b.rule !== "payor-branch" &&
    b.rule !== "payor-unknown" &&
    !onScreen.some((o) => family(o.rule) === family(b.rule))
      ? {
          ...b,
          message: `${b.message} What is on screen meets this, but it is not saved yet: save the certificate first.`,
        }
      : b,
  );

  // Item 1 From / To: the calendar bounds of the chosen quarter. Deterministic,
  // not a guess — a quarter has fixed first and last days.
  const qn = Number(quarter.replace("Q", "")) || 1;
  const [qFrom, qTo] = QUARTER_BOUNDS[qn] ?? QUARTER_BOUNDS[1]!;
  const periodFrom = year ? `${qFrom}/${year}` : "";
  const periodTo = year ? `${qTo}/${year}` : "";

  /** Re-render the PDF preview whenever anything the sheet shows changes. */
  const revisionKey = JSON.stringify([debounced, party, c?.totalTax, c?.totalIncome]);

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
        A 2307 is <span className="font-semibold text-content">issued to a payee</span>,
        not e-filed — BIR publishes no eBIRForms XML for it. The deliverable is the
        printed certificate. Switch to{" "}
        <span className="font-semibold text-content">Form</span> to see the sheet as the
        BIR prints it, on{" "}
        <span className="font-semibold text-content">long bond (8.5 × 13 in)</span>.
      </div>

      {correctFrom && usableSource ? (
        <div className="mb-6 rounded-card border border-gold/50 bg-warn-bg-2 px-4 py-3 text-[12.5px] text-content">
          <span className="font-semibold">A corrected certificate.</span> Pre-filled from
          an issued certificate as a convenience. This is a new certificate; the issued
          one stays as it is.
        </div>
      ) : correctFrom && (source.isError || (source.data && !usableSource)) ? (
        <div
          role="alert"
          className="mb-6 rounded-input border border-danger/40 bg-danger-bg px-4 py-3 text-[12.5px] text-danger-ink"
        >
          The certificate to correct could not be loaded, so nothing is pre-filled. This
          is a blank new certificate.
        </div>
      ) : null}

      {error ? (
        <div className="mb-5 rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <FormViewShell
        mode={mode}
        onModeChange={setMode}
        rootRef={docRef}
        filename={pdfName}
        pagePt={LONG_BOND_PT}
        revisionKey={revisionKey}
        sheets={
          <Form2307
            periodFrom={periodFrom}
            periodTo={periodTo}
            payee={{
              tin: payeeTin,
              branch: payeeBranch,
              name: payeeName,
              address: payeeAddress,
              zip: payeeZip,
              foreignAddress: payeeForeignAddress,
            }}
            payor={{
              tin: party.tin,
              branch: party.branch,
              name: party.businessName,
              address: [party.address, party.city].filter(Boolean).join(", "),
              zip: party.zip,
            }}
            rows={rows}
            rowTotals={(c?.rows ?? []).map((r) => r.total)}
            totals={{
              m1: c?.tM1 ?? 0,
              m2: c?.tM2 ?? 0,
              m3: c?.tM3 ?? 0,
              income: c?.totalIncome ?? 0,
              tax: c?.totalTax ?? 0,
            }}
            payorSignatory={toSignatory(payorSig)}
            payeeSignatory={toSignatory(
              payeeSig,
              payeeName,
              tin14(payeeTin, payeeBranch),
            )}
          />
        }
        actions={
          <>
            <Button
              variant="outline"
              disabled={!clientId || printing}
              onClick={() => void printPdf()}
            >
              {printing ? "Preparing PDF…" : "Print certificate (PDF)"}
            </Button>
            {/* Kept so a person can print both paths and lay them side by side
                against a blank BIR 2307. Removed in W4. */}
            <Button
              variant="ghost"
              size="sm"
              disabled={printingLegacy}
              onClick={() => void printLegacyPdf()}
            >
              {printingLegacy ? "Preparing…" : "Print (legacy)"}
            </Button>
          </>
        }
        guided={
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <fieldset disabled={isFiled} className="min-w-0 space-y-6">
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
                        disabled={
                          !isNew ||
                          (!!correctFrom &&
                            !source.isError &&
                            !(source.data && !usableSource))
                        }
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
                        Year
                      </span>
                      <input
                        className="input w-full font-mono"
                        value={year}
                        onChange={(e) =>
                          setYear(e.target.value.replace(/\D/g, "").slice(0, 4))
                        }
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[13px] font-semibold text-content">
                        Quarter
                      </span>
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

              {/* Payee */}
              <Card>
                <CardContent className="space-y-3">
                  <div className="eyebrow">Payee — who this certificate is issued to</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-[13px] font-semibold text-content">
                        Payee name
                      </span>
                      <input
                        className="input w-full"
                        value={payeeName}
                        onChange={(e) => setPayeeName(e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[13px] font-semibold text-content">
                        Payee TIN
                      </span>
                      <input
                        className="input w-full font-mono"
                        value={payeeTin}
                        onChange={(e) => setPayeeTin(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-[13px] font-semibold text-content">
                        Payee branch code{" "}
                        <span className="text-content-secondary">(required)</span>
                      </span>
                      <select
                        className="input w-full"
                        required
                        value={payeeBranchSel}
                        onChange={(e) =>
                          setPayeeBranchSel(e.target.value as PayeeBranchChoice)
                        }
                      >
                        {PAYEE_BRANCH_CHOICES.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {payeeBranchSel === "other" ? (
                      <label className="block">
                        <span className="mb-1.5 block text-[13px] font-semibold text-content">
                          Branch code (5 digits)
                        </span>
                        <input
                          className="input w-full font-mono"
                          required
                          inputMode="numeric"
                          maxLength={5}
                          value={payeeBranchTyped}
                          onChange={(e) =>
                            setPayeeBranchTyped(
                              e.target.value.replace(/\D/g, "").slice(0, 5),
                            )
                          }
                        />
                      </label>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                    <label className="block">
                      <span className="mb-1.5 block text-[13px] font-semibold text-content">
                        Registered address{" "}
                        <span className="text-content-secondary">(item 4)</span>
                      </span>
                      <input
                        className="input w-full"
                        value={payeeAddress}
                        onChange={(e) => setPayeeAddress(e.target.value)}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[13px] font-semibold text-content">
                        ZIP Code <span className="text-content-secondary">(4A)</span>
                      </span>
                      <input
                        className="input w-full font-mono"
                        value={payeeZip}
                        maxLength={4}
                        onChange={(e) =>
                          setPayeeZip(e.target.value.replace(/\D/g, "").slice(0, 4))
                        }
                      />
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-semibold text-content">
                      Foreign address, if applicable{" "}
                      <span className="text-content-secondary">(item 5 — optional)</span>
                    </span>
                    <input
                      className="input w-full"
                      value={payeeForeignAddress}
                      onChange={(e) => setPayeeForeignAddress(e.target.value)}
                    />
                  </label>
                </CardContent>
              </Card>

              {/* Income payments */}
              <Card>
                <CardContent>
                  <div className="eyebrow mb-2">
                    Income payments subject to withholding
                  </div>
                  <div className="overflow-x-auto rounded-card border border-line">
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-line bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                          <th className="px-3 py-2.5 font-semibold">ATC</th>
                          <th className="px-3 py-2.5 text-right font-semibold">
                            1st month
                          </th>
                          <th className="px-3 py-2.5 text-right font-semibold">
                            2nd month
                          </th>
                          <th className="px-3 py-2.5 text-right font-semibold">
                            3rd month
                          </th>
                          <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                          <th className="px-3 py-2.5 text-right font-semibold">
                            Tax withheld
                          </th>
                          <th className="w-10 px-3 py-2.5" />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          // Each line is two table rows: the ATC and amounts as
                          // before, then its Part III description at full width,
                          // so the added field squeezes no column (W3 F14).
                          <Fragment key={i}>
                            <tr
                              className={
                                i > 0 ? "border-t border-line-divider" : undefined
                              }
                            >
                              <td className="px-3 py-2">
                                <select
                                  className="input w-full min-w-[8.5rem]"
                                  aria-label={`ATC, row ${i + 1}`}
                                  value={r.atc}
                                  onChange={(e) => updateRow(i, { atc: e.target.value })}
                                >
                                  <option value="">Select ATC…</option>
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
                                    onChange={(e) =>
                                      updateRow(i, { [k]: e.target.value })
                                    }
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
                                  onClick={() =>
                                    setRows((prev) => prev.filter((_, j) => j !== i))
                                  }
                                >
                                  ✕
                                </Button>
                              </td>
                            </tr>
                            <tr>
                              <td colSpan={7} className="px-3 pb-2.5 pt-0">
                                <input
                                  className="input w-full"
                                  aria-label={`Income payment, row ${i + 1}`}
                                  placeholder="Income payment — the description Part III prints for this line"
                                  value={r.desc}
                                  onChange={(e) => updateRow(i, { desc: e.target.value })}
                                />
                              </td>
                            </tr>
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length < 10 ? (
                    <div className="mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRows((p) => [...p, emptyRow()])}
                      >
                        + Add line
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {/* Signatories — the printed text under each signature line. The
              signature itself is wet ink and stays blank (R6). */}
              <Card>
                <CardContent className="space-y-4">
                  <div className="eyebrow">
                    Signatories — printed under each signature line
                  </div>
                  <p className="text-[12.5px] text-content-secondary">
                    All optional. The signature itself is signed by hand; these are the
                    lines the BIR form prints beneath it.
                  </p>
                  <SignatoryFields
                    legend="Payor / withholding agent"
                    value={payorSig}
                    onChange={setPayorSig}
                  />
                  <SignatoryFields
                    legend="Payee (CONFORME)"
                    value={payeeSig}
                    onChange={setPayeeSig}
                    namePlaceholder={payeeName}
                    tinPlaceholder={payeeTin}
                  />
                </CardContent>
              </Card>
            </fieldset>

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
                    <div
                      key={label as string}
                      className="flex items-center justify-between"
                    >
                      <span className="text-[13px] text-content-secondary">{label}</span>
                      <span className="font-mono tabular-nums text-content">
                        {peso(Number(v ?? 0))}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-line-strong pt-2">
                    <span className="text-[13px] font-semibold text-navy">
                      Total tax withheld
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[15px] font-semibold tabular-nums text-navy",
                      )}
                    >
                      {peso(Number(c?.totalTax ?? 0))}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {clientId && blockers.length > 0 ? (
                <div
                  data-testid="issue-blockers"
                  className="space-y-1.5 rounded-card border border-gold/50 bg-warn-bg-2 px-3.5 py-2.5 text-[12.5px] text-content"
                >
                  <div className="font-semibold">Not ready to issue</div>
                  {blockers.map((b) => (
                    <p key={b.rule}>
                      {b.message}
                      {b.rule === "payor-branch" ? (
                        <>
                          {" "}
                          <Link
                            to={`/clients/${clientId}/edit`}
                            className="font-semibold text-blue underline-offset-2 hover:underline"
                          >
                            Edit the client
                          </Link>
                        </>
                      ) : null}
                    </p>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                {isFiled ? null : (
                  <Button
                    disabled={!clientId || save.isPending || setStatus.isPending}
                    onClick={() => save.mutate()}
                  >
                    {save.isPending ? "Saving…" : isNew ? "Save draft" : "Save changes"}
                  </Button>
                )}
                {!isNew ? (
                  isFiled && existing.data ? (
                    <FiledFormAction detail={existing.data} />
                  ) : (
                    <Button
                      variant="outline"
                      disabled={
                        setStatus.isPending ||
                        save.isPending ||
                        existing.isFetching ||
                        blockers.length > 0
                      }
                      onClick={() => setStatus.mutate("filed")}
                    >
                      {setStatus.isPending ? "Marking…" : "Mark as issued"}
                    </Button>
                  )
                ) : null}
              </div>

              {isFiled ? (
                <FiledBanner form="2307" filedAt={existing.data?.filedAt}>
                  This certificate is recorded as handed to the payee.
                </FiledBanner>
              ) : null}
            </div>
          </div>
        }
      />

      {/* The pre-pass-2 hand-written A4 sheet. Kept off-screen until W4,
          reachable through "Print (legacy)" so the two printouts can be
          compared on paper. Prints from the same payor source (W3 R3). */}
      <div className="bir-sheet-stage" aria-hidden="true">
        <div ref={legacySheetRef} className="bir-sheet">
          <Sheet2307
            year={year}
            quarter={quarter}
            agentName={party.businessName}
            agentTin={party.tin}
            agentAddress={[party.address, party.city].filter(Boolean).join(", ")}
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

/** Map the editor's flat signatory state onto the sheet's prop shape. */
function toSignatory(
  v: SignatoryState,
  nameFallback?: string,
  tinFallback?: string,
): Form2307Signatory {
  return {
    name: v.Name || nameFallback || "",
    title: v.Title,
    tin: v.Tin || tinFallback || "",
    taxAgentNo: v.TaxAgentNo,
    issued: v.TaxAgentIssued,
    expiry: v.TaxAgentExpiry,
  };
}

/** The six printed lines under one signature. All optional (R6). */
function SignatoryFields({
  legend,
  value,
  onChange,
  namePlaceholder,
  tinPlaceholder,
}: {
  legend: string;
  value: SignatoryState;
  onChange: (next: SignatoryState) => void;
  namePlaceholder?: string;
  tinPlaceholder?: string;
}) {
  const set = (k: SignatoryKey, v: string) => onChange({ ...value, [k]: v });
  return (
    <fieldset className="rounded-card border border-line px-3.5 py-3">
      <legend className="px-1 text-[12.5px] font-semibold text-content">{legend}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] text-content-secondary">
            Printed name
          </span>
          <input
            className="input w-full"
            value={value.Name}
            placeholder={namePlaceholder || ""}
            onChange={(e) => set("Name", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] text-content-secondary">
            Title / designation
          </span>
          <input
            className="input w-full"
            value={value.Title}
            onChange={(e) => set("Title", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] text-content-secondary">TIN</span>
          <input
            className="input w-full font-mono"
            value={value.Tin}
            placeholder={tinPlaceholder || ""}
            onChange={(e) => set("Tin", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] text-content-secondary">
            Tax Agent Accreditation / Roll No.
          </span>
          <input
            className="input w-full font-mono"
            value={value.TaxAgentNo}
            onChange={(e) => set("TaxAgentNo", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] text-content-secondary">
            Date of issue (MM/DD/YYYY)
          </span>
          <input
            className="input w-full font-mono"
            value={value.TaxAgentIssued}
            placeholder="MM/DD/YYYY"
            onChange={(e) => set("TaxAgentIssued", e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] text-content-secondary">
            Date of expiry (MM/DD/YYYY)
          </span>
          <input
            className="input w-full font-mono"
            value={value.TaxAgentExpiry}
            placeholder="MM/DD/YYYY"
            onChange={(e) => set("TaxAgentExpiry", e.target.value)}
          />
        </label>
      </div>
    </fieldset>
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
