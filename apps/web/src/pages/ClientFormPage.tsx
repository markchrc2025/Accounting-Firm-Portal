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
// Type-only import — erased at build, so pdf.js/tesseract stay OUT of the main
// chunk (the extractor itself is loaded lazily in onPickCor). parseCor.ts is the
// pure, dependency-free module, so this never pulls the heavy OCR deps.
import type { ExtractedCor } from "../lib/cor/parseCor";

// Enums replicated from the API DTO (apps/api/src/clients/dto/client.schemas.ts).
// The web app can't import that schema, so the option lists live here.
const TAX_TYPES = ["VAT", "PERCENTAGE"] as const;
const BILLING_METHODS = ["QUARTERLY", "MONTHLY", "AS_FILING"] as const;

type Kind = "individual" | "non-individual";
type TaxRow = { type: string; form: string; frequency: string; startDate: string };

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
      return <main className="mx-auto max-w-3xl px-6 py-10 text-gray-500">Loading…</main>;
    }
    if (client.isError || !client.data) {
      return (
        <main className="mx-auto max-w-3xl px-6 py-10 text-red-700">
          Could not load this client.
        </main>
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
  const [tin, setTin] = useState(existing?.tin ?? "");
  const [branch, setBranch] = useState(existing?.branch ?? "00000");
  const [rdo, setRdo] = useState(existing?.rdo ?? "");
  const [rdoName, setRdoName] = useState(existing?.rdoName ?? "");
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
  const [zip, setZip] = useState(existing?.zip ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");

  // --- Tax Types ------------------------------------------------------------
  const [taxTypes, setTaxTypes] = useState<TaxRow[]>(() => initialTaxRows(existing));

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
    } catch {
      setCorHint(
        "Couldn't read this COR automatically — please fill the form by hand.",
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

  function buildPayload(): Record<string, unknown> {
    const p: Record<string, unknown> = {};
    const put = (k: string, v: string) => {
      const t = v.trim();
      if (t !== "") p[k] = t;
    };

    p.businessName = businessName.trim();
    put("currency", currency.trim().toUpperCase());
    if (seatLimit.trim() !== "") {
      const seat = Number(seatLimit);
      if (Number.isFinite(seat)) p.seatLimit = seat;
    }

    p.kind = kind;
    put("tin", tin);
    put("branch", branch);
    put("taxType", taxType);
    put("rdo", rdo);
    put("rdoName", rdoName);
    put("tradeName", tradeName);
    put("classification", classification);
    put("citizenship", citizenship);

    if (kind === "non-individual") {
      put("regName", regName);
      put("taxpayerType", taxpayerType);
      if (incorpDate) p.incorpDate = incorpDate; // <input type=date> → yyyy-mm-dd
    } else {
      put("lastName", lastName);
      put("firstName", firstName);
      put("middleName", middleName);
      put("civilStatus", civilStatus);
      if (birthdate) p.birthdate = birthdate;
    }

    put("address", address);
    put("city", city);
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
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link
        to={existing ? `/clients/${existing.id}` : "/"}
        className="text-sm text-gray-500 hover:underline"
      >
        ← {existing ? "Back to client" : "Dashboard"}
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">
        {existing ? "Edit client" : "Add client"}
      </h1>
      <p className="mb-6 text-sm text-gray-600">
        BIR filer profile and firm engagement details.
      </p>

      {error && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* (a) COR upload + OCR auto-fill --------------------------------- */}
        <section className="rounded-lg border border-gray-200 p-5">
          <h2 className="mb-1 text-lg font-semibold">Certificate of Registration</h2>
          <p className="mb-3 text-xs text-gray-500">
            Upload a BIR Form 2303 (PDF or photo) to read the filer details. The file
            stays in your browser — nothing is uploaded. You review the result before
            it fills the form.
          </p>

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
            className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-6 text-center text-sm text-gray-600 hover:border-gray-400"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*"
              className="hidden"
              onChange={(e) => onPickCor(e.target.files?.[0] ?? null)}
            />
            <span className="font-medium text-gray-700">Drop a COR here</span> or click to
            browse (PDF or image)
          </div>

          {existing && currentCorPath && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
              <span className="text-gray-700">A COR file is stored for this client.</span>
              <button
                type="button"
                onClick={viewCurrentCor}
                disabled={corBusy}
                className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
              >
                View current COR
              </button>
              <button
                type="button"
                onClick={removeCurrentCor}
                disabled={corBusy}
                className="rounded border border-gray-300 px-3 py-1 text-sm text-red-600 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          )}

          {corFile && (
            <p className="mt-3 text-xs text-gray-600">
              Selected file: <span className="font-medium">{corFile.name}</span> — it will be
              uploaded when you save.
            </p>
          )}

          {corWarning && (
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {corWarning}
            </div>
          )}

          {corExtracting && (
            <div className="mt-3">
              <p className="text-xs text-gray-600">
                Reading COR… {corStage} ({Math.round(corPct * 100)}%)
              </p>
              <div className="mt-1 h-2 w-full overflow-hidden rounded bg-gray-100">
                <div
                  className="h-full bg-gray-900 transition-all"
                  style={{ width: `${Math.round(corPct * 100)}%` }}
                />
              </div>
            </div>
          )}

          {corHint && (
            <div className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {corHint}
            </div>
          )}

          {corExtracted && (
            <div className="mt-3 rounded border border-gray-300 bg-gray-50 p-3 text-sm">
              <p className="mb-2 font-medium text-gray-800">Review extracted details</p>
              <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
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
                <SummaryRow
                  label="Tax Types"
                  value={`${corExtracted.taxTypes.length}`}
                />
              </dl>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={!hasExtracted}
                  onClick={() => applyExtracted(corExtracted)}
                  className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Apply to form
                </button>
                <button
                  type="button"
                  onClick={() => setCorExtracted(null)}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </section>

        {/* (b) Identity --------------------------------------------------- */}
        <section className="rounded-lg border border-gray-200 p-5">
          <h2 className="mb-3 text-lg font-semibold">Identity</h2>

          <Field label="Business / display name" error={fieldErrors.businessName}>
            <input
              required
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="input"
            />
          </Field>

          <div className="mt-3">
            <span className="text-sm font-medium text-gray-700">Taxpayer kind</span>
            <div className="mt-1 inline-flex overflow-hidden rounded border border-gray-300">
              {(["individual", "non-individual"] as Kind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`px-4 py-2 text-sm ${
                    kind === k ? "bg-gray-900 text-white" : "bg-white text-gray-700"
                  }`}
                >
                  {k === "individual" ? "Individual" : "Non-individual"}
                </button>
              ))}
            </div>
          </div>

          {kind === "non-individual" ? (
            <div className="mt-3 space-y-3">
              <Field label="Registered name" error={fieldErrors.regName}>
                <input
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  className="input"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
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
              </div>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-3 gap-3">
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
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date of birth" error={fieldErrors.birthdate}>
                  <input
                    type="date"
                    value={birthdate}
                    onChange={(e) => setBirthdate(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Civil status" error={fieldErrors.civilStatus}>
                  <input
                    value={civilStatus}
                    onChange={(e) => setCivilStatus(e.target.value)}
                    className="input"
                  />
                </Field>
              </div>
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Trade name" error={fieldErrors.tradeName}>
              <input
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Classification" error={fieldErrors.classification}>
              <input
                value={classification}
                onChange={(e) => setClassification(e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
            <Field label="TIN" error={fieldErrors.tin}>
              <input
                value={tin}
                onChange={(e) => setTin(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Branch code" error={fieldErrors.branch}>
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Citizenship" error={fieldErrors.citizenship}>
              <input
                value={citizenship}
                onChange={(e) => setCitizenship(e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="RDO code" error={fieldErrors.rdo}>
              <input
                value={rdo}
                onChange={(e) => setRdo(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="RDO name" error={fieldErrors.rdoName}>
              <input
                value={rdoName}
                onChange={(e) => setRdoName(e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3">
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
            <Field label="Currency" error={fieldErrors.currency}>
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                maxLength={3}
                className="input"
              />
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
        </section>

        {/* (c) Contact ---------------------------------------------------- */}
        <section className="rounded-lg border border-gray-200 p-5">
          <h2 className="mb-3 text-lg font-semibold">Contact</h2>
          <Field label="Registered address" error={fieldErrors.address}>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="input"
            />
          </Field>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="City" error={fieldErrors.city}>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="ZIP" error={fieldErrors.zip}>
              <input
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                className="input"
              />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
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
                className="input"
              />
            </Field>
          </div>
        </section>

        {/* (d) Tax Types -------------------------------------------------- */}
        <section className="rounded-lg border border-gray-200 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Tax types</h2>
            <button
              type="button"
              onClick={addTaxRow}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm"
            >
              + Add row
            </button>
          </div>
          {taxTypes.length === 0 ? (
            <p className="text-sm text-gray-500">
              No registered tax types. Upload a COR above or add rows manually.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="hidden grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-medium uppercase text-gray-500 sm:grid">
                <span>Type</span>
                <span>Form</span>
                <span>Frequency</span>
                <span>Start date</span>
                <span></span>
              </div>
              {taxTypes.map((row, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"
                >
                  <input
                    aria-label="Tax type"
                    placeholder="Type"
                    value={row.type}
                    onChange={(e) => updateTaxRow(idx, { type: e.target.value })}
                    className="input"
                  />
                  <input
                    aria-label="Form"
                    placeholder="Form"
                    value={row.form}
                    onChange={(e) => updateTaxRow(idx, { form: e.target.value })}
                    className="input"
                  />
                  <input
                    aria-label="Frequency"
                    placeholder="Frequency"
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
                  <button
                    type="button"
                    onClick={() => removeTaxRow(idx)}
                    className="rounded border border-gray-300 px-3 py-2 text-sm text-red-600"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* (e) Engagement (firm-only) ------------------------------------- */}
        <section className="rounded-lg border border-indigo-200 bg-indigo-50 p-5">
          <h2 className="mb-1 text-lg font-semibold text-indigo-900">Engagement</h2>
          <p className="mb-3 text-xs text-indigo-700">
            Firm-only billing details. Never exported to the BIR Generator.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Professional fee (₱)" error={fieldErrors.professionalFee}>
              <input
                type="number"
                step="0.01"
                min="0"
                value={professionalFee}
                onChange={(e) => setProfessionalFee(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Billing method" error={fieldErrors.billingMethod}>
              <select
                value={billingMethod}
                onChange={(e) => setBillingMethod(e.target.value)}
                className="input"
              >
                {BILLING_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        {/* Footer --------------------------------------------------------- */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => navigate(existing ? `/clients/${existing.id}` : "/")}
            className="rounded border border-gray-300 px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : existing ? "Save changes" : "Create client"}
          </button>
        </div>
      </form>
    </main>
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
      <dt className="text-gray-500">{label}:</dt>
      <dd className="text-gray-900">{value && value.trim() ? value : "—"}</dd>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-gray-700">{label}</span>
      <div className="mt-1">{children}</div>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}
