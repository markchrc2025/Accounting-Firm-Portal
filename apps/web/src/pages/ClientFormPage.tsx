import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  createClient,
  deleteCor,
  fetchClient,
  getCorUrl,
  updateClient,
  uploadCor,
  type Client,
} from "../lib/api";
import {
  Button,
  Card,
  CardContent,
  Chip,
  ErrorState,
  PageHeader,
  Skeleton,
  cn,
} from "../components/ui";
import { CityCombobox } from "../components/CityCombobox";
// Type-only import — erased at build, so pdf.js/tesseract stay OUT of the main
// chunk (the extractor itself is loaded lazily in onPickCor). parseCor.ts is the
// pure, dependency-free module, so this never pulls the heavy OCR deps.
import type { ExtractedCor } from "../lib/cor/parseCor";

// Enums replicated from the API DTO (apps/api/src/clients/dto/client.schemas.ts).
// The web app can't import that schema, so the option lists live here.
const TAX_TYPES = ["VAT", "PERCENTAGE"] as const;
const BILLING_METHODS = ["QUARTERLY", "MONTHLY", "AS_FILING"] as const;
// Civil status (standard BIR Form 1901/1902 set) and taxpayer classification —
// picked from a fixed list rather than free-typed, mirroring Sentire Tax.
const CIVIL_STATUSES = ["Single", "Married", "Widow/Widower", "Legally Separated"] as const;
const CLASSIFICATIONS = [
  "Professional",
  "Single Proprietorship",
  "Domestic Corporation",
  "Partnership",
] as const;

/** Format a raw TIN (digits) as ###-###-### for display (Sentire style). */
function formatTin(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 9);
  const parts = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean);
  return parts.join("-");
}
// Human-readable labels for the billing segmented control (presentation only —
// the bound value is still the enum string above).
const BILLING_LABELS: Record<(typeof BILLING_METHODS)[number], string> = {
  QUARTERLY: "Quarterly",
  MONTHLY: "Monthly",
  AS_FILING: "As filing",
};

type Kind = "individual" | "non-individual";
type TaxRow = { type: string; form: string; frequency: string; startDate: string };
type BranchRow = {
  branchCode: string;
  tradeName: string;
  address: string;
  city: string;
  province: string;
  region: string;
  zip: string;
  rdo: string;
};
const EMPTY_BRANCH: BranchRow = {
  branchCode: "",
  tradeName: "",
  address: "",
  city: "",
  province: "",
  region: "",
  zip: "",
  rdo: "",
};

/** Branch rows from a saved client's `branchesJson` (best-effort, all optional). */
function initialBranches(existing: Client | null): BranchRow[] {
  const rows = existing?.branchesJson;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({ ...EMPTY_BRANCH, ...r }));
}

/** Route wrapper: fetches the client for edit-prefill, then renders the form. */
export default function ClientFormPage() {
  const { clientId } = useParams();
  const isEdit = Boolean(clientId);

  const client = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchClient(clientId as string),
    enabled: isEdit,
  });

  if (isEdit) {
    if (client.isPending) {
      return (
        <div className="max-w-[940px] animate-fade-rise">
          <PageHeader eyebrow="Client / Filer" title="Edit client" />
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-card" />
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full rounded-input" />
              ))}
            </div>
            <Skeleton className="h-40 w-full rounded-card" />
          </div>
        </div>
      );
    }
    if (client.isError || !client.data) {
      return (
        <div className="max-w-[940px] animate-fade-rise">
          <PageHeader eyebrow="Client / Filer" title="Edit client" />
          <ErrorState
            message="Could not load this client."
            onRetry={() => client.refetch()}
          />
        </div>
      );
    }
    return <ClientForm existing={client.data} />;
  }
  return <ClientForm existing={null} />;
}

function initialTaxRows(existing: Client | null): TaxRow[] {
  const rows = existing?.taxTypesJson;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    type: r.type ?? "",
    form: r.form ?? "",
    frequency: r.frequency ?? "",
    startDate: r.startDate ?? "",
  }));
}

function ClientForm({ existing }: { existing: Client | null }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // --- Identity -------------------------------------------------------------
  const [businessName, setBusinessName] = useState(existing?.businessName ?? "");
  const [kind, setKind] = useState<Kind>(
    existing?.kind === "individual" ? "individual" : "non-individual",
  );
  const [regName, setRegName] = useState(existing?.regName ?? "");
  const [incorpDate, setIncorpDate] = useState(existing?.incorpDate?.slice(0, 10) ?? "");
  const [taxpayerType, setTaxpayerType] = useState(existing?.taxpayerType ?? "");
  const [lastName, setLastName] = useState(existing?.lastName ?? "");
  const [firstName, setFirstName] = useState(existing?.firstName ?? "");
  const [middleName, setMiddleName] = useState(existing?.middleName ?? "");
  const [birthdate, setBirthdate] = useState(existing?.birthdate?.slice(0, 10) ?? "");
  const [civilStatus, setCivilStatus] = useState(existing?.civilStatus ?? "");
  const [tradeName, setTradeName] = useState(existing?.tradeName ?? "");
  // TIN is held as raw digits; the input renders it with dashes via formatTin.
  const [tin, setTin] = useState((existing?.tin ?? "").replace(/\D/g, "").slice(0, 9));
  const [branch, setBranch] = useState(existing?.branch ?? "00000");
  const [rdo, setRdo] = useState(existing?.rdo ?? "");
  const [classification, setClassification] = useState(existing?.classification ?? "");
  const [citizenship, setCitizenship] = useState(existing?.citizenship ?? "");
  const [taxType, setTaxType] = useState(existing?.taxType ?? "");
  const [currency, setCurrency] = useState(existing?.currency ?? "PHP");
  const [seatLimit, setSeatLimit] = useState(
    existing?.seatLimit != null ? String(existing.seatLimit) : "3",
  );

  // --- Contact --------------------------------------------------------------
  const [address, setAddress] = useState(existing?.address ?? "");
  const [city, setCity] = useState(existing?.city ?? "");
  const [province, setProvince] = useState(existing?.province ?? "");
  const [region, setRegion] = useState(existing?.region ?? "");
  const [zip, setZip] = useState(existing?.zip ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");

  // --- Tax Types ------------------------------------------------------------
  const [taxTypes, setTaxTypes] = useState<TaxRow[]>(() => initialTaxRows(existing));

  // --- Branches -------------------------------------------------------------
  const [branches, setBranches] = useState<BranchRow[]>(() => initialBranches(existing));
  const [hasBranches, setHasBranches] = useState<boolean>(
    () => Boolean(existing?.hasBranches) || initialBranches(existing).length > 0,
  );

  // --- Engagement -----------------------------------------------------------
  const [professionalFee, setProfessionalFee] = useState(
    existing?.professionalFee != null ? String(existing.professionalFee) : "",
  );
  const [billingMethod, setBillingMethod] = useState(existing?.billingMethod ?? "AS_FILING");

  // --- Save state -----------------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Warning surfaced when the client saved but the COR file upload failed —
  // the save is NOT lost; the upload can be retried by saving again.
  const [corWarning, setCorWarning] = useState<string | null>(null);
  // Once a create succeeds, remember the id so a retry (after a COR upload
  // failure) updates the same record instead of creating a duplicate.
  const createdIdRef = useRef<string | null>(null);

  // --- COR OCR (client-side, no backend) ------------------------------------
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [corExtracting, setCorExtracting] = useState(false);
  const [corStage, setCorStage] = useState("");
  const [corPct, setCorPct] = useState(0);
  const [corExtracted, setCorExtracted] = useState<ExtractedCor | null>(null);
  const [corHint, setCorHint] = useState<string | null>(null);
  // The picked COR file, held so it can be uploaded to the saved client on Save.
  const [corFile, setCorFile] = useState<File | null>(null);
  // The stored COR key in edit mode (drives "View current COR" / "Remove").
  const [currentCorPath, setCurrentCorPath] = useState<string | null>(
    existing?.corPath ?? null,
  );
  const [corBusy, setCorBusy] = useState(false);

  async function onPickCor(file: File | null) {
    if (!file) return;
    // Reject oversize before OCR/upload — the server caps the COR at 10 MB.
    if (file.size > 10 * 1024 * 1024) {
      setCorFile(null);
      setCorExtracted(null);
      setCorHint("That file is larger than 10 MB — please upload a smaller COR.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setCorFile(file);
    setCorExtracted(null);
    setCorHint(null);
    setCorExtracting(true);
    setCorStage("Preparing document");
    setCorPct(0);
    try {
      // Dynamic import keeps pdf.js + tesseract.js in their own chunk, loaded
      // only when a user actually uploads a COR.
      const { extractCorFromFile } = await import("../lib/cor/extractCor");
      const res = await extractCorFromFile(file, (stage, pct) => {
        setCorStage(stage);
        setCorPct(pct);
      });
      setCorExtracted(res);
    } catch (err) {
      // Keep the raw error in the console for support, and show the specific
      // reason (asset/engine load vs. read failure) rather than a dead end.
      console.error("COR extraction failed:", err);
      const reason = err instanceof Error && err.message ? err.message : "";
      setCorHint(
        reason
          ? `Couldn't read this COR automatically — ${reason} You can still fill the form by hand.`
          : "Couldn't read this COR automatically — please fill the form by hand.",
      );
    } finally {
      setCorExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /** Merge extracted fields into the draft. Only non-empty values overwrite, and
   *  tax types are APPENDED (deduped) so manual rows are never clobbered. The
   *  user must click this — OCR is never auto-applied. */
  function applyExtracted(x: ExtractedCor) {
    if (x.kind) setKind(x.kind);
    if (x.regName) {
      setRegName(x.regName);
      // businessName is the one required create field; seed it from regName
      // without clobbering anything the user already typed.
      setBusinessName((prev) => prev || x.regName || "");
    }
    if (x.lastName) setLastName(x.lastName);
    if (x.firstName) setFirstName(x.firstName);
    if (x.middleName) setMiddleName(x.middleName);
    if (x.tradeName) setTradeName(x.tradeName);
    if (x.tin) setTin(x.tin);
    if (x.branch) setBranch(x.branch);
    if (x.rdo) setRdo(x.rdo);
    if (x.address) setAddress(x.address);
    if (x.zip) setZip(x.zip);
    if (x.taxTypes.length) {
      setTaxTypes((prev) => {
        const seen = new Set(prev.map((r) => `${r.type}|${r.form}`.toUpperCase()));
        const merged = [...prev];
        for (const t of x.taxTypes) {
          const key = `${t.type}|${t.form}`.toUpperCase();
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push({
            type: t.type,
            form: t.form,
            frequency: t.frequency,
            startDate: t.startDate ?? "",
          });
        }
        return merged;
      });
    }
    setCorExtracted(null);
  }

  function addTaxRow() {
    setTaxTypes((prev) => [...prev, { type: "", form: "", frequency: "", startDate: "" }]);
  }
  function removeTaxRow(idx: number) {
    setTaxTypes((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateTaxRow(idx: number, patch: Partial<TaxRow>) {
    setTaxTypes((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addBranch() {
    setBranches((prev) => [...prev, { ...EMPTY_BRANCH }]);
  }
  function removeBranch(idx: number) {
    setBranches((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateBranch(idx: number, patch: Partial<BranchRow>) {
    setBranches((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function buildPayload(): Record<string, unknown> {
    const p: Record<string, unknown> = {};
    // On CREATE we omit empty optionals (cleaner). On EDIT we send "" too, so
    // clearing a previously-set field actually persists (the API maps "" → null
    // for dates and to an empty string for text; UpdateClientSchema needs ≥1 key,
    // which is always satisfied). Dates only clear via "" when editing.
    const isEdit = Boolean(existing);
    const put = (k: string, v: string) => {
      const t = v.trim();
      if (t !== "" || isEdit) p[k] = t;
    };
    const putDate = (k: string, v: string) => {
      if (v) p[k] = v; // <input type=date> emits yyyy-mm-dd
      else if (isEdit) p[k] = ""; // clear on edit
    };
    // Constrained fields (enum / fixed length) must NEVER be sent as "" — that
    // would fail Zod. Always omit when empty, even on edit.
    const putStrict = (k: string, v: string) => {
      const t = v.trim();
      if (t !== "") p[k] = t;
    };

    p.businessName = businessName.trim();
    putStrict("currency", currency.trim().toUpperCase()); // z.string().length(3)
    if (seatLimit.trim() !== "") {
      const seat = Number(seatLimit);
      if (Number.isFinite(seat)) p.seatLimit = seat;
    }

    p.kind = kind;
    put("tin", tin);
    put("branch", branch);
    putStrict("taxType", taxType); // ClientTaxType enum (VAT | PERCENTAGE)
    put("rdo", rdo);
    put("tradeName", tradeName);
    put("classification", classification);
    put("citizenship", citizenship);

    if (kind === "non-individual") {
      put("regName", regName);
      put("taxpayerType", taxpayerType);
      putDate("incorpDate", incorpDate);
      // On edit, clear any stale individual-only fields left from a kind switch.
      if (isEdit) {
        p.lastName = "";
        p.firstName = "";
        p.middleName = "";
        p.civilStatus = "";
        p.birthdate = "";
      }
    } else {
      put("lastName", lastName);
      put("firstName", firstName);
      put("middleName", middleName);
      put("civilStatus", civilStatus);
      putDate("birthdate", birthdate);
      if (isEdit) {
        p.regName = "";
        p.taxpayerType = "";
        p.incorpDate = "";
      }
    }

    put("address", address);
    put("city", city);
    put("province", province);
    put("region", region);
    put("zip", zip);
    put("phone", phone);
    // email: the DTO accepts a valid address OR "" — always send it.
    p.email = email.trim();

    if (professionalFee.trim() !== "") {
      const fee = Number(professionalFee);
      if (Number.isFinite(fee)) p.professionalFee = fee;
    }
    p.billingMethod = billingMethod;

    // Sent as an array even when empty so an edit that clears every row persists.
    p.taxTypes = taxTypes
      .filter((r) => r.type.trim() || r.form.trim() || r.frequency.trim())
      .map((r) => {
        const row: Record<string, string> = {
          type: r.type.trim(),
          form: r.form.trim(),
          frequency: r.frequency.trim(),
        };
        if (r.startDate.trim()) row.startDate = r.startDate.trim();
        return row;
      });

    // Branches: only when the toggle is on; drop entirely-empty rows. Sent as an
    // array (empty when off) so turning branches off on an edit clears them.
    p.hasBranches = hasBranches;
    p.branches = hasBranches
      ? branches
          .filter((b) =>
            [b.branchCode, b.tradeName, b.address, b.city].some((v) => v.trim()),
          )
          .map((b) => ({
            branchCode: b.branchCode.trim(),
            tradeName: b.tradeName.trim(),
            address: b.address.trim(),
            city: b.city.trim(),
            province: b.province.trim(),
            region: b.region.trim(),
            zip: b.zip.trim(),
            rdo: b.rdo.trim(),
          }))
      : [];

    return p;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setCorWarning(null);
    setBusy(true);
    const payload = buildPayload();
    try {
      // Save the client first. In create mode, reuse a previously-created id if a
      // prior attempt succeeded but the COR upload failed (avoids duplicates).
      let savedId: string;
      if (existing) {
        await updateClient(existing.id, payload);
        savedId = existing.id;
      } else if (createdIdRef.current) {
        await updateClient(createdIdRef.current, payload);
        savedId = createdIdRef.current;
      } else {
        const saved = await createClient(payload);
        savedId = saved.id;
        createdIdRef.current = saved.id;
      }
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["client", savedId] });

      // Best-effort COR upload. A failure must NOT lose the saved client — we
      // keep the user on the page with a warning so they can retry (saving again
      // updates the same record and re-attempts the upload).
      if (corFile) {
        try {
          await uploadCor(savedId, corFile);
          setCorFile(null);
          setCurrentCorPath(savedId);
        } catch {
          setCorWarning(
            "The client was saved, but the COR file could not be uploaded. Save again to retry.",
          );
          setBusy(false);
          return;
        }
      }

      navigate(existing ? `/clients/${savedId}` : "/");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const body = err.body as { errors?: { path: string; message: string }[] };
        if (body?.errors) {
          setFieldErrors(Object.fromEntries(body.errors.map((x) => [x.path, x.message])));
        }
      } else {
        setError("Save failed");
      }
    } finally {
      setBusy(false);
    }
  }

  /** Open the stored COR in a new tab via a short-lived signed URL. */
  async function viewCurrentCor() {
    if (!existing) return;
    setCorBusy(true);
    setCorWarning(null);
    try {
      const { url } = await getCorUrl(existing.id);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else setCorWarning("No stored COR file was found.");
    } catch {
      setCorWarning("Could not open the stored COR file.");
    } finally {
      setCorBusy(false);
    }
  }

  /** Remove the stored COR file from object storage. */
  async function removeCurrentCor() {
    if (!existing) return;
    setCorBusy(true);
    setCorWarning(null);
    try {
      await deleteCor(existing.id);
      setCurrentCorPath(null);
      queryClient.invalidateQueries({ queryKey: ["client", existing.id] });
    } catch {
      setCorWarning("Could not remove the stored COR file.");
    } finally {
      setCorBusy(false);
    }
  }

  const hasExtracted = Boolean(
    corExtracted &&
      (corExtracted.regName ||
        corExtracted.lastName ||
        corExtracted.firstName ||
        corExtracted.tradeName ||
        corExtracted.tin ||
        corExtracted.rdo ||
        corExtracted.address ||
        corExtracted.taxTypes.length),
  );

  return (
    <div className="max-w-[940px] animate-fade-rise">
      <Link
        to={existing ? `/clients/${existing.id}` : "/"}
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-blue underline-offset-2 hover:text-navy-hover hover:underline"
      >
        ← {existing ? "Back to client" : "Dashboard"}
      </Link>

      <PageHeader
        eyebrow="Client / Filer"
        title={existing ? "Edit client" : "Add client"}
        description="BIR filer profile and firm engagement details."
      />

      {error && (
        <div className="mb-5 rounded-input border border-danger/40 bg-danger-bg px-4 py-3 text-[13px] text-danger-ink">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* (a) COR upload + OCR auto-fill --------------------------------- */}
        <Card>
          <CardContent className="space-y-4">
            <div className="eyebrow">Certificate of Registration</div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onPickCor(e.dataTransfer.files?.[0] ?? null);
              }}
              className="flex cursor-pointer flex-col items-center gap-3 rounded-card border-2 border-dashed border-line-input bg-sidebar/60 px-6 py-9 text-center transition-colors hover:border-gold"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => onPickCor(e.target.files?.[0] ?? null)}
              />
              <span
                aria-hidden
                className="flex h-11 w-11 items-center justify-center rounded-full bg-warn-bg-2 text-gold"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 15V3m0 0L8 7m4-4 4 4" />
                  <path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4" />
                </svg>
              </span>
              <div>
                <div className="text-[14px] font-semibold text-navy">
                  Drop a COR here, or browse
                </div>
                <p className="mx-auto mt-1 max-w-md text-[12.5px] text-content-secondary">
                  BIR Form 2303 (PDF or photo). The file stays in your browser — you
                  review the result before it fills the form.
                </p>
              </div>
              <span className="pointer-events-none inline-flex items-center justify-center rounded-btn bg-navy px-4 py-[7px] text-[13px] font-semibold text-white">
                Browse files
              </span>
            </div>

            {existing && currentCorPath && (
              <div className="flex flex-wrap items-center gap-3 rounded-input border border-success/30 bg-success-bg px-4 py-3 text-[13px]">
                <span aria-hidden className="font-semibold text-success">
                  ✓
                </span>
                <span className="font-medium text-content">
                  A COR file is stored for this client.
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="link"
                    size="sm"
                    onClick={viewCurrentCor}
                    disabled={corBusy}
                  >
                    View current COR
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={removeCurrentCor}
                    disabled={corBusy}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            )}

            {corFile && (
              <div className="flex items-center gap-2 rounded-input border border-success/30 bg-success-bg px-4 py-3 text-[13px] text-content">
                <span aria-hidden className="font-semibold text-success">
                  ✓
                </span>
                <span>
                  Selected file:{" "}
                  <span className="font-mono font-medium text-content">{corFile.name}</span>{" "}
                  — it will be uploaded when you save.
                </span>
              </div>
            )}

            {corWarning && (
              <div className="rounded-input border border-warn/40 bg-warn-bg px-4 py-3 text-[13px] text-warn">
                {corWarning}
              </div>
            )}

            {corExtracting && (
              <div className="rounded-input border border-info/30 bg-info-bg px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="font-semibold text-navy">Reading COR… {corStage}</span>
                  <span className="font-mono text-[12px] text-content-secondary">
                    {Math.round(corPct * 100)}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-info/20">
                  <div
                    className="h-full rounded-full bg-info transition-all"
                    style={{ width: `${Math.round(corPct * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {corHint && (
              <div className="rounded-input border border-danger/30 bg-danger-bg px-4 py-3 text-[13px] text-danger-ink">
                {corHint}
              </div>
            )}

            {corExtracted && (
              <div className="rounded-card border border-line bg-sidebar/60 p-4">
                <div className="eyebrow mb-3">Review extracted details</div>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
                  <SummaryRow label="Name" value={extractedName(corExtracted)} />
                  <SummaryRow label="Trade name" value={corExtracted.tradeName} />
                  <SummaryRow
                    label="TIN"
                    value={
                      corExtracted.tin
                        ? corExtracted.branch
                          ? `${corExtracted.tin} · ${corExtracted.branch}`
                          : corExtracted.tin
                        : ""
                    }
                  />
                  <SummaryRow label="RDO" value={corExtracted.rdo} />
                  <SummaryRow
                    label="Address"
                    value={
                      corExtracted.address
                        ? corExtracted.zip
                          ? `${corExtracted.address} · ${corExtracted.zip}`
                          : corExtracted.address
                        : ""
                    }
                  />
                  <SummaryRow label="Tax Types" value={`${corExtracted.taxTypes.length}`} />
                </dl>
                <div className="mt-4 flex gap-2">
                  <Button
                    size="sm"
                    disabled={!hasExtracted}
                    onClick={() => applyExtracted(corExtracted)}
                  >
                    Apply to form
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setCorExtracted(null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* (b) Identity --------------------------------------------------- */}
        <Card>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="eyebrow">Filer identity</div>
              <div
                role="group"
                aria-label="Taxpayer kind"
                className="inline-flex rounded-btn border border-line-input bg-card p-1"
              >
                {(["individual", "non-individual"] as Kind[]).map((k) => {
                  const active = kind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setKind(k)}
                      className={cn(
                        "rounded-[5px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
                        active ? "bg-navy text-white" : "text-content-secondary hover:bg-rowhover",
                      )}
                    >
                      {k === "individual" ? "Individual" : "Non-individual"}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field
                className="md:col-span-2"
                label="Business / display name"
                error={fieldErrors.businessName}
              >
                <input
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="input"
                />
              </Field>

              {kind === "non-individual" ? (
                <>
                  <Field
                    className="md:col-span-2"
                    label="Registered name"
                    error={fieldErrors.regName}
                  >
                    <input
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      className="input"
                    />
                  </Field>
                  <Field label="Date of incorporation" error={fieldErrors.incorpDate}>
                    <input
                      type="date"
                      value={incorpDate}
                      onChange={(e) => setIncorpDate(e.target.value)}
                      className="input"
                    />
                  </Field>
                  <Field label="Taxpayer type" error={fieldErrors.taxpayerType}>
                    <input
                      value={taxpayerType}
                      onChange={(e) => setTaxpayerType(e.target.value)}
                      className="input"
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Last name" error={fieldErrors.lastName}>
                    <input
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="input"
                    />
                  </Field>
                  <Field label="First name" error={fieldErrors.firstName}>
                    <input
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="input"
                    />
                  </Field>
                  <Field label="Middle name" error={fieldErrors.middleName}>
                    <input
                      value={middleName}
                      onChange={(e) => setMiddleName(e.target.value)}
                      className="input"
                    />
                  </Field>
                  <Field label="Date of birth" error={fieldErrors.birthdate}>
                    <input
                      type="date"
                      value={birthdate}
                      onChange={(e) => setBirthdate(e.target.value)}
                      className="input"
                    />
                  </Field>
                  <Field label="Civil status" error={fieldErrors.civilStatus}>
                    <select
                      value={civilStatus}
                      onChange={(e) => setCivilStatus(e.target.value)}
                      className="input"
                    >
                      <option value="">Not set</option>
                      {CIVIL_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}

              <Field label="Trade name" error={fieldErrors.tradeName}>
                <input
                  value={tradeName}
                  onChange={(e) => setTradeName(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Classification" error={fieldErrors.classification}>
                <select
                  value={classification}
                  onChange={(e) => setClassification(e.target.value)}
                  className="input"
                >
                  <option value="">Not set</option>
                  {CLASSIFICATIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="TIN" error={fieldErrors.tin}>
                <input
                  value={formatTin(tin)}
                  onChange={(e) => setTin(e.target.value.replace(/\D/g, "").slice(0, 9))}
                  inputMode="numeric"
                  placeholder="000-000-000"
                  className="input font-mono"
                />
              </Field>
              <Field label="Branch code" error={fieldErrors.branch}>
                <input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="input font-mono"
                />
              </Field>
              <Field label="Citizenship" error={fieldErrors.citizenship}>
                <input
                  value={citizenship}
                  onChange={(e) => setCitizenship(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Currency" error={fieldErrors.currency}>
                <input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  maxLength={3}
                  className="input font-mono"
                />
              </Field>

              <Field label="RDO code" error={fieldErrors.rdo}>
                <input
                  value={rdo}
                  onChange={(e) => setRdo(e.target.value)}
                  className="input font-mono"
                />
              </Field>

              <Field label="Tax regime" error={fieldErrors.taxType}>
                <select
                  value={taxType}
                  onChange={(e) => setTaxType(e.target.value)}
                  className="input"
                >
                  <option value="">Not set</option>
                  {TAX_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Seat limit" error={fieldErrors.seatLimit}>
                <input
                  type="number"
                  min="3"
                  value={seatLimit}
                  onChange={(e) => setSeatLimit(e.target.value)}
                  className="input"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* (c) Contact ---------------------------------------------------- */}
        <Card>
          <CardContent className="space-y-5">
            <div className="eyebrow">Contact</div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                className="md:col-span-2"
                label="Registered address"
                error={fieldErrors.address}
              >
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="City / Municipality" error={fieldErrors.city}>
                <CityCombobox
                  value={city}
                  error={Boolean(fieldErrors.city)}
                  onChange={setCity}
                  onSelect={(loc) => {
                    // Selecting a suggestion auto-fills the whole address block.
                    setCity(loc.city);
                    setProvince(loc.province);
                    setRegion(loc.region);
                    if (loc.zip) setZip(loc.zip);
                  }}
                />
              </Field>
              <Field label="ZIP" error={fieldErrors.zip}>
                <input
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  inputMode="numeric"
                  className="input font-mono"
                />
              </Field>
              <Field label="Province" error={fieldErrors.province}>
                <input
                  value={province}
                  onChange={(e) => setProvince(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Region" error={fieldErrors.region}>
                <input
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Email" error={fieldErrors.email}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="Phone" error={fieldErrors.phone}>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="input font-mono"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        {/* (d) Tax Types -------------------------------------------------- */}
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="eyebrow">Registered tax types</div>
              <Button variant="outline" size="sm" onClick={addTaxRow}>
                + Add row
              </Button>
            </div>
            {taxTypes.length === 0 ? (
              <p className="text-[13px] text-content-secondary">
                No registered tax types. Upload a COR above or add rows manually.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="hidden gap-3 px-0.5 font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary md:grid md:grid-cols-[1.4fr_0.8fr_1fr_1fr_auto]">
                  <span>Type</span>
                  <span>Form</span>
                  <span>Frequency</span>
                  <span>Start date</span>
                  <span />
                </div>
                {taxTypes.map((row, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_0.8fr_1fr_1fr_auto] md:items-center"
                  >
                    <input
                      aria-label="Tax type"
                      placeholder="Value-Added Tax"
                      value={row.type}
                      onChange={(e) => updateTaxRow(idx, { type: e.target.value })}
                      className="input"
                    />
                    <input
                      aria-label="Form"
                      placeholder="2550Q"
                      value={row.form}
                      onChange={(e) => updateTaxRow(idx, { form: e.target.value })}
                      className="input font-mono"
                    />
                    <input
                      aria-label="Frequency"
                      placeholder="Quarterly"
                      value={row.frequency}
                      onChange={(e) => updateTaxRow(idx, { frequency: e.target.value })}
                      className="input"
                    />
                    <input
                      aria-label="Start date"
                      type="date"
                      value={row.startDate}
                      onChange={(e) => updateTaxRow(idx, { startDate: e.target.value })}
                      className="input"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove tax type ${idx + 1}`}
                      onClick={() => removeTaxRow(idx)}
                      className="text-content-muted hover:text-danger"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* (d2) Branches -------------------------------------------------- */}
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="eyebrow">Branches</div>
                <p className="mt-1 text-[12.5px] text-content-secondary">
                  Branch offices share the client&apos;s TIN with a distinct branch code.
                </p>
              </div>
              <div
                role="group"
                aria-label="With branches"
                className="inline-flex rounded-btn border border-line-input bg-card p-1"
              >
                {[false, true].map((on) => (
                  <button
                    key={String(on)}
                    type="button"
                    aria-pressed={hasBranches === on}
                    onClick={() => {
                      setHasBranches(on);
                      if (on && branches.length === 0) addBranch();
                    }}
                    className={cn(
                      "rounded-[5px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
                      hasBranches === on
                        ? "bg-navy text-white"
                        : "text-content-secondary hover:bg-rowhover",
                    )}
                  >
                    {on ? "With branches" : "No branches"}
                  </button>
                ))}
              </div>
            </div>

            {hasBranches && (
              <>
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={addBranch}>
                    + Add branch
                  </Button>
                </div>
                {branches.length === 0 ? (
                  <p className="text-[13px] text-content-secondary">
                    No branches yet. Click “Add branch” to enter one from its COR.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="min-w-[900px] space-y-3">
                      <div className="grid grid-cols-[0.7fr_1.3fr_1.7fr_1fr_1fr_0.7fr_0.7fr_auto] gap-2 px-0.5 font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                        <span>Branch code</span>
                        <span>Trade name</span>
                        <span>Registered address</span>
                        <span>City</span>
                        <span>Province</span>
                        <span>ZIP</span>
                        <span>RDO</span>
                        <span />
                      </div>
                      {branches.map((b, idx) => (
                        <div
                          key={idx}
                          className="grid grid-cols-[0.7fr_1.3fr_1.7fr_1fr_1fr_0.7fr_0.7fr_auto] items-center gap-2"
                        >
                          <input
                            aria-label="Branch code"
                            placeholder="00001"
                            value={b.branchCode}
                            onChange={(e) =>
                              updateBranch(idx, {
                                branchCode: e.target.value.replace(/\D/g, "").slice(0, 5),
                              })
                            }
                            className="input font-mono"
                          />
                          <input
                            aria-label="Trade name"
                            value={b.tradeName}
                            onChange={(e) => updateBranch(idx, { tradeName: e.target.value })}
                            className="input"
                          />
                          <input
                            aria-label="Registered address"
                            value={b.address}
                            onChange={(e) => updateBranch(idx, { address: e.target.value })}
                            className="input"
                          />
                          <input
                            aria-label="City"
                            value={b.city}
                            onChange={(e) => updateBranch(idx, { city: e.target.value })}
                            className="input"
                          />
                          <input
                            aria-label="Province"
                            value={b.province}
                            onChange={(e) => updateBranch(idx, { province: e.target.value })}
                            className="input"
                          />
                          <input
                            aria-label="ZIP"
                            value={b.zip}
                            onChange={(e) =>
                              updateBranch(idx, { zip: e.target.value.replace(/\D/g, "").slice(0, 4) })
                            }
                            className="input font-mono"
                          />
                          <input
                            aria-label="RDO"
                            value={b.rdo}
                            onChange={(e) => updateBranch(idx, { rdo: e.target.value })}
                            className="input font-mono"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove branch ${idx + 1}`}
                            onClick={() => removeBranch(idx)}
                            className="text-content-muted hover:text-danger"
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* (e) Engagement (firm-only) ------------------------------------- */}
        <Card className="border border-warn/40 bg-warn-bg-2">
          <CardContent className="space-y-5">
            <div className="flex items-center gap-2">
              <Chip variant="gold">FIRM-INTERNAL</Chip>
              <span className="font-serif text-[15px] font-medium text-navy">Engagement</span>
            </div>
            <p className="text-[12.5px] text-content-secondary">
              Firm-only billing details — never exported to the BIR Generator.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Professional fee" error={fieldErrors.professionalFee}>
                <div className="relative">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-content-secondary"
                  >
                    ₱
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={professionalFee}
                    onChange={(e) => setProfessionalFee(e.target.value)}
                    placeholder="0.00"
                    className="input pl-7 font-mono"
                  />
                </div>
              </Field>
              <div>
                <span className="mb-1.5 block text-[13px] font-semibold text-content">
                  Billing method
                </span>
                <div
                  role="group"
                  aria-label="Billing method"
                  className="inline-flex flex-wrap rounded-btn border border-line-input bg-card p-1"
                >
                  {BILLING_METHODS.map((m) => {
                    const active = billingMethod === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setBillingMethod(m)}
                        className={cn(
                          "rounded-[5px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
                          active ? "bg-navy text-white" : "text-content-secondary hover:bg-rowhover",
                        )}
                      >
                        {BILLING_LABELS[m]}
                      </button>
                    );
                  })}
                </div>
                {fieldErrors.billingMethod && (
                  <span className="mt-1 block text-xs text-danger">
                    {fieldErrors.billingMethod}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer --------------------------------------------------------- */}
        <div className="flex items-center justify-end gap-3 border-t border-line pt-5">
          <Button
            variant="ghost"
            onClick={() => navigate(existing ? `/clients/${existing.id}` : "/")}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : existing ? "Save changes" : "Create client"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** "LAST, FIRST MIDDLE" for individuals, or the company registered name. */
function extractedName(x: ExtractedCor): string {
  if (x.regName) return x.regName;
  const given = [x.firstName, x.middleName].filter(Boolean).join(" ");
  if (x.lastName) return given ? `${x.lastName}, ${given}` : x.lastName;
  return given;
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-content-secondary">{label}:</dt>
      <dd className="text-content">{value && value.trim() ? value : "—"}</dd>
    </div>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="text-[13px] font-semibold text-content">{label}</span>
      <div className="mt-1.5">{children}</div>
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}
