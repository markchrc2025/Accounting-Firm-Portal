import * as React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  FileText,
  Plus,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import {
  Button,
  Card,
  CardContent,
  Chip,
  ErrorState,
  Input,
  Label,
  PageHeader,
  RegimeChip,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@/components/ui";
import { api } from "@/mock";
import type {
  BillingMethod,
  CivilStatus,
  Client,
  ClientTaxType,
  FilerType,
  Regime,
  TaxpayerClassification,
  TaxpayerType,
  TaxTypeFrequency,
} from "@/types";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------------- *
 * Local form state
 * ------------------------------------------------------------------------- */

type CorState = "empty" | "uploading" | "filled" | "error";

/** Every scalar filer field. Selects use "" for the unset/placeholder state. */
interface FormState {
  registeredName: string;
  tradeName: string;
  lastName: string;
  firstName: string;
  middleName: string;
  tin: string;
  branchCode: string;
  rdoCode: string;
  classification: TaxpayerClassification | "";
  citizenship: string;
  dateOfBirth: string;
  civilStatus: CivilStatus | "";
  taxpayerType: TaxpayerType | "";
  dateOfIncorporation: string;
  address: string;
  city: string;
  zip: string;
  email: string;
  phone: string;
  professionalFee: string;
}

const EMPTY_FORM: FormState = {
  registeredName: "",
  tradeName: "",
  lastName: "",
  firstName: "",
  middleName: "",
  tin: "",
  branchCode: "",
  rdoCode: "",
  classification: "",
  citizenship: "",
  dateOfBirth: "",
  civilStatus: "",
  taxpayerType: "",
  dateOfIncorporation: "",
  address: "",
  city: "",
  zip: "",
  email: "",
  phone: "",
  professionalFee: "",
};

const blankTaxType = (): ClientTaxType => ({
  taxType: "",
  form: "",
  frequency: "Quarterly",
  startDate: "",
});

/** Malaya-style sample fields the COR "reader" pretends to extract. */
const COR_SAMPLE_FORM: FormState = {
  registeredName: "Malaya Trading Corp.",
  tradeName: "Malaya Trading",
  lastName: "Malaya",
  firstName: "",
  middleName: "",
  tin: "010-582-334-000",
  branchCode: "00000",
  rdoCode: "047",
  classification: "Large",
  citizenship: "Filipino",
  dateOfBirth: "",
  civilStatus: "",
  taxpayerType: "Corporation",
  dateOfIncorporation: "2015-03-18",
  address: "12F Ayala Triangle Tower 2, Paseo de Roxas, Bel-Air",
  city: "Makati City",
  zip: "1226",
  email: "ramon@malayatrading.ph",
  phone: "+63 917 555 0142",
  professionalFee: "25000",
};

const COR_SAMPLE_TAXTYPES: ClientTaxType[] = [
  { taxType: "Value-Added Tax", form: "2550Q", frequency: "Quarterly", startDate: "2015-04-01" },
  { taxType: "Income Tax", form: "1701Q", frequency: "Quarterly", startDate: "2015-04-01" },
  { taxType: "Expanded Withholding Tax", form: "0619-E", frequency: "Monthly", startDate: "2015-04-01" },
  { taxType: "Registration Fee", form: "0605", frequency: "Annually", startDate: "2015-04-01" },
];

/* ------------------------------------------------------------------------- *
 * Small presentational helpers
 * ------------------------------------------------------------------------- */

const FROM_COR_CHIP = (
  <Chip variant="gold" size="sm">
    FROM COR
  </Chip>
);

function FieldLabel({
  htmlFor,
  children,
  fromCor,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  fromCor?: boolean;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <Label htmlFor={htmlFor}>{children}</Label>
      {fromCor ? FROM_COR_CHIP : null}
    </div>
  );
}

/** Segmented control — a bordered row of mutually-exclusive buttons. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-btn border border-line-input bg-card p-1"
    >
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt)}
            className={cn(
              "rounded-[5px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
              active
                ? "bg-navy text-white"
                : "text-content-secondary hover:bg-rowhover",
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Screen
 * ------------------------------------------------------------------------- */

export function ClientFormScreen() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);

  const [filerType, setFilerType] = React.useState<FilerType>("company");
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [taxTypes, setTaxTypes] = React.useState<ClientTaxType[]>([blankTaxType()]);
  const [billingMethod, setBillingMethod] = React.useState<BillingMethod>("Quarterly");

  const [corState, setCorState] = React.useState<CorState>("empty");
  const [corFilename, setCorFilename] = React.useState<string>("");

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const uploadTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const fromCor = corState === "filled";

  /* --- Edit mode: load + prefill ------------------------------------------ */
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["client", id],
    queryFn: () => api.getClient(id as string),
    enabled: isEdit,
  });

  React.useEffect(() => {
    if (!data) return;
    const c: Client = data;
    setFilerType(c.filerType);
    setForm({
      registeredName: c.name,
      tradeName: c.tradeName ?? "",
      lastName: c.lastName ?? "",
      firstName: c.firstName ?? "",
      middleName: c.middleName ?? "",
      tin: c.tin,
      branchCode: c.branchCode,
      rdoCode: c.rdoCode,
      classification: c.classification,
      citizenship: c.citizenship ?? "",
      dateOfBirth: c.dateOfBirth ?? "",
      civilStatus: c.civilStatus ?? "",
      taxpayerType: c.taxpayerType ?? "",
      dateOfIncorporation: c.dateOfIncorporation ?? "",
      address: c.address ?? "",
      city: c.city,
      zip: c.zip ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      professionalFee: String(c.professionalFee),
    });
    setTaxTypes(c.taxTypes.length ? c.taxTypes.map((t) => ({ ...t })) : [blankTaxType()]);
    setBillingMethod(c.billingMethod);
  }, [data]);

  /* --- Cleanup the simulated-read timer on unmount ------------------------ */
  React.useEffect(() => {
    return () => {
      if (uploadTimer.current) clearTimeout(uploadTimer.current);
    };
  }, []);

  /* --- Field setters ------------------------------------------------------ */
  const setField = React.useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const updateTaxType = React.useCallback(
    <K extends keyof ClientTaxType>(index: number, key: K, value: ClientTaxType[K]) => {
      setTaxTypes((prev) =>
        prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
      );
    },
    [],
  );

  const addTaxType = () => setTaxTypes((prev) => [...prev, blankTaxType()]);
  const removeTaxType = (index: number) =>
    setTaxTypes((prev) => prev.filter((_, i) => i !== index));

  /* --- COR upload simulation --------------------------------------------- */
  const runCorRead = (filename: string) => {
    if (uploadTimer.current) clearTimeout(uploadTimer.current);
    setCorFilename(filename);
    setCorState("uploading");
    uploadTimer.current = setTimeout(() => {
      setForm(COR_SAMPLE_FORM);
      setTaxTypes(COR_SAMPLE_TAXTYPES.map((t) => ({ ...t })));
      setFilerType("company");
      setBillingMethod("Monthly");
      setCorState("filled");
    }, 1600);
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    runCorRead(file.name);
    e.target.value = "";
  };

  const removeCor = () => {
    if (uploadTimer.current) clearTimeout(uploadTimer.current);
    setCorState("empty");
    setCorFilename("");
  };

  /* --- Derived regime from tax types ------------------------------------- */
  const derivedRegime: Regime | null = taxTypes.some((t) => t.form.trim() === "2550Q")
    ? "VAT"
    : taxTypes.some((t) => t.form.trim() === "2551Q")
      ? "PERCENTAGE"
      : null;

  /* --- Loading skeleton (edit) ------------------------------------------- */
  if (isEdit && isLoading) {
    return (
      <div className="max-w-[940px]">
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

  if (isEdit && isError) {
    return (
      <div className="max-w-[940px]">
        <PageHeader eyebrow="Client / Filer" title="Edit client" />
        <ErrorState message="Couldn't load this client." onRetry={() => refetch()} />
      </div>
    );
  }

  const save = () => navigate("/clients");
  const cancel = () => navigate("/clients");

  /* ----------------------------------------------------------------------- */
  return (
    <div className="max-w-[940px]">
      <PageHeader
        eyebrow="Client / Filer"
        title={isEdit ? "Edit client" : "Add client"}
        description="Mirrors a BIR filer-registration record — a client maps 1:1 onto a taxpayer."
        actions={
          <div
            role="group"
            aria-label="Filer type"
            className="inline-flex overflow-hidden rounded-btn border border-line-input"
          >
            <button
              type="button"
              aria-pressed={filerType === "individual"}
              onClick={() => setFilerType("individual")}
              className={cn(
                "px-4 py-2 text-[13px] font-semibold transition-colors",
                filerType === "individual"
                  ? "bg-navy text-white"
                  : "bg-card text-content-secondary hover:bg-rowhover",
              )}
            >
              Individual
            </button>
            <button
              type="button"
              aria-pressed={filerType === "company"}
              onClick={() => setFilerType("company")}
              className={cn(
                "border-l border-line-input px-4 py-2 text-[13px] font-semibold transition-colors",
                filerType === "company"
                  ? "bg-navy text-white"
                  : "bg-card text-content-secondary hover:bg-rowhover",
              )}
            >
              Non-Individual (Company)
            </button>
          </div>
        }
      />

      <div className="space-y-6">
        {/* ---------------- COR upload card ---------------- */}
        <CorUploadCard
          state={corState}
          filename={corFilename}
          fileInputRef={fileInputRef}
          onBrowse={() => fileInputRef.current?.click()}
          onFilePicked={onFilePicked}
          onRemove={removeCor}
          onError={() => setCorState("error")}
          onManual={removeCor}
        />

        {/* ---------------- Filer identity ---------------- */}
        <Card>
          <CardContent className="space-y-5">
            <div className="eyebrow">Filer identity</div>

            <div className="grid gap-4 md:grid-cols-2">
              {filerType === "company" ? (
                <>
                  <div className="md:col-span-2">
                    <FieldLabel htmlFor="registeredName" fromCor={fromCor}>
                      Registered name
                    </FieldLabel>
                    <Input
                      id="registeredName"
                      value={form.registeredName}
                      onChange={(e) => setField("registeredName", e.target.value)}
                      placeholder="Registered corporate name"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <FieldLabel htmlFor="tradeName">Trade name (optional)</FieldLabel>
                    <Input
                      id="tradeName"
                      value={form.tradeName}
                      onChange={(e) => setField("tradeName", e.target.value)}
                      placeholder="Doing-business-as name"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <FieldLabel htmlFor="lastName" fromCor={fromCor}>
                      Last name
                    </FieldLabel>
                    <Input
                      id="lastName"
                      value={form.lastName}
                      onChange={(e) => setField("lastName", e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="firstName">First name</FieldLabel>
                    <Input
                      id="firstName"
                      value={form.firstName}
                      onChange={(e) => setField("firstName", e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="middleName">Middle name</FieldLabel>
                    <Input
                      id="middleName"
                      value={form.middleName}
                      onChange={(e) => setField("middleName", e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="tradeName">Trade name (optional)</FieldLabel>
                    <Input
                      id="tradeName"
                      value={form.tradeName}
                      onChange={(e) => setField("tradeName", e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* Shared identity row */}
              <div>
                <FieldLabel htmlFor="tin" fromCor={fromCor}>
                  TIN
                </FieldLabel>
                <Input
                  id="tin"
                  className="font-mono"
                  value={form.tin}
                  onChange={(e) => setField("tin", e.target.value)}
                  placeholder="000-000-000"
                />
              </div>
              <div>
                <FieldLabel htmlFor="branchCode" fromCor={fromCor}>
                  Branch code
                </FieldLabel>
                <Input
                  id="branchCode"
                  className="font-mono"
                  value={form.branchCode}
                  onChange={(e) => setField("branchCode", e.target.value)}
                  placeholder="00000"
                />
              </div>
              <div>
                <FieldLabel htmlFor="rdoCode" fromCor={fromCor}>
                  RDO code
                </FieldLabel>
                <Input
                  id="rdoCode"
                  className="font-mono"
                  value={form.rdoCode}
                  onChange={(e) => setField("rdoCode", e.target.value)}
                  placeholder="047"
                />
              </div>
              <div>
                <FieldLabel htmlFor="classification">Classification</FieldLabel>
                <Select
                  value={form.classification}
                  onValueChange={(v) => setField("classification", v as TaxpayerClassification)}
                >
                  <SelectTrigger id="classification">
                    <SelectValue placeholder="Select classification" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Small">Small</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="Large">Large</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel htmlFor="citizenship">Citizenship</FieldLabel>
                <Input
                  id="citizenship"
                  value={form.citizenship}
                  onChange={(e) => setField("citizenship", e.target.value)}
                  placeholder="Filipino"
                />
              </div>

              {/* Individual-only */}
              {filerType === "individual" ? (
                <>
                  <div>
                    <FieldLabel htmlFor="dateOfBirth">Date of birth</FieldLabel>
                    <Input
                      id="dateOfBirth"
                      type="date"
                      value={form.dateOfBirth}
                      onChange={(e) => setField("dateOfBirth", e.target.value)}
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor="civilStatus">Civil status</FieldLabel>
                    <Select
                      value={form.civilStatus}
                      onValueChange={(v) => setField("civilStatus", v as CivilStatus)}
                    >
                      <SelectTrigger id="civilStatus">
                        <SelectValue placeholder="Select civil status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Single">Single</SelectItem>
                        <SelectItem value="Married">Married</SelectItem>
                        <SelectItem value="Widowed">Widowed</SelectItem>
                        <SelectItem value="Separated">Separated</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <FieldLabel htmlFor="taxpayerType">Taxpayer type</FieldLabel>
                    <Select
                      value={form.taxpayerType}
                      onValueChange={(v) => setField("taxpayerType", v as TaxpayerType)}
                    >
                      <SelectTrigger id="taxpayerType">
                        <SelectValue placeholder="Select taxpayer type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Corporation">Corporation</SelectItem>
                        <SelectItem value="Partnership">Partnership</SelectItem>
                        <SelectItem value="OPC">OPC</SelectItem>
                        <SelectItem value="Cooperative">Cooperative</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="dateOfIncorporation">
                      Date of incorporation
                    </FieldLabel>
                    <Input
                      id="dateOfIncorporation"
                      type="date"
                      value={form.dateOfIncorporation}
                      onChange={(e) => setField("dateOfIncorporation", e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Contact block */}
            <div className="border-t border-line pt-5">
              <div className="eyebrow mb-4">Contact</div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <FieldLabel htmlFor="address" fromCor={fromCor}>
                    Registered address
                  </FieldLabel>
                  <Input
                    id="address"
                    value={form.address}
                    onChange={(e) => setField("address", e.target.value)}
                    placeholder="Unit / building / street / barangay"
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="city">City</FieldLabel>
                  <Input
                    id="city"
                    value={form.city}
                    onChange={(e) => setField("city", e.target.value)}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="zip">ZIP</FieldLabel>
                  <Input
                    id="zip"
                    className="font-mono"
                    value={form.zip}
                    onChange={(e) => setField("zip", e.target.value)}
                    placeholder="0000"
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setField("email", e.target.value)}
                    placeholder="name@company.ph"
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="phone">Phone</FieldLabel>
                  <Input
                    id="phone"
                    className="font-mono"
                    value={form.phone}
                    onChange={(e) => setField("phone", e.target.value)}
                    placeholder="+63 900 000 0000"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ---------------- Tax types table ---------------- */}
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="eyebrow">Registered tax types</div>
                {fromCor ? FROM_COR_CHIP : null}
              </div>
              {derivedRegime ? (
                <div className="flex items-center gap-2 text-[12px] text-content-secondary">
                  <span>Derived regime:</span>
                  <RegimeChip regime={derivedRegime} />
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              {taxTypes.map((row, index) => (
                <div
                  key={index}
                  className="grid items-end gap-3 md:grid-cols-[1.4fr_0.8fr_1fr_1fr_auto]"
                >
                  <div>
                    <FieldLabel htmlFor={`taxType-${index}`}>Tax type</FieldLabel>
                    <Input
                      id={`taxType-${index}`}
                      value={row.taxType}
                      onChange={(e) => updateTaxType(index, "taxType", e.target.value)}
                      placeholder="Value-Added Tax"
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`form-${index}`}>Form</FieldLabel>
                    <Input
                      id={`form-${index}`}
                      className="font-mono"
                      value={row.form}
                      onChange={(e) => updateTaxType(index, "form", e.target.value)}
                      placeholder="2550Q"
                    />
                  </div>
                  <div>
                    <FieldLabel htmlFor={`frequency-${index}`}>Frequency</FieldLabel>
                    <Select
                      value={row.frequency}
                      onValueChange={(v) =>
                        updateTaxType(index, "frequency", v as TaxTypeFrequency)
                      }
                    >
                      <SelectTrigger id={`frequency-${index}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Monthly">Monthly</SelectItem>
                        <SelectItem value="Quarterly">Quarterly</SelectItem>
                        <SelectItem value="Annually">Annually</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel htmlFor={`startDate-${index}`}>Start date</FieldLabel>
                    <Input
                      id={`startDate-${index}`}
                      type="date"
                      value={row.startDate}
                      onChange={(e) => updateTaxType(index, "startDate", e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove tax type ${index + 1}`}
                    onClick={() => removeTaxType(index)}
                    className="h-[38px] w-[38px] px-0 text-content-muted hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ))}
            </div>

            <Button type="button" variant="outline" size="sm" onClick={addTaxType}>
              <Plus className="h-4 w-4" aria-hidden />
              Add tax type
            </Button>
          </CardContent>
        </Card>

        {/* ---------------- Engagement card (firm-internal) ---------------- */}
        <Card className="border-warn/40 bg-warn-bg-2">
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Chip variant="gold">FIRM-INTERNAL</Chip>
                <span className="font-serif text-[14.5px] font-bold text-content">
                  Engagement
                </span>
              </div>
            </div>
            <p className="text-[12.5px] text-content-secondary">
              Not part of the BIR filer profile — never exported to BIR forms.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <FieldLabel htmlFor="professionalFee">Professional fee</FieldLabel>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-content-secondary">
                    ₱
                  </span>
                  <Input
                    id="professionalFee"
                    inputMode="decimal"
                    className="pl-7 font-mono"
                    value={form.professionalFee}
                    onChange={(e) => setField("professionalFee", e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <div className="mb-1.5">
                  <Label>Billing method</Label>
                </div>
                <Segmented
                  ariaLabel="Billing method"
                  options={["Quarterly", "Monthly", "As Filing"] as const}
                  value={billingMethod}
                  onChange={setBillingMethod}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ---------------- Footer ---------------- */}
        <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-3 border-t border-line bg-paper/95 px-1 py-4 backdrop-blur">
          <Button type="button" variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={save}>
            Save client
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * COR upload card — four visual states
 * ------------------------------------------------------------------------- */

function CorUploadCard({
  state,
  filename,
  fileInputRef,
  onBrowse,
  onFilePicked,
  onRemove,
  onError,
  onManual,
}: {
  state: CorState;
  filename: string;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onBrowse: () => void;
  onFilePicked: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  onError: () => void;
  onManual: () => void;
}) {
  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
      className="hidden"
      onChange={onFilePicked}
      aria-hidden
    />
  );

  if (state === "uploading") {
    return (
      <Card className="border-info/30 bg-info-bg">
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[14px] font-semibold text-navy">Reading COR… 62%</div>
            <FileText className="h-5 w-5 text-info" aria-hidden />
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-info/20"
            role="progressbar"
            aria-valuenow={62}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full w-[62%] rounded-full bg-info" />
          </div>
          <p className="text-[12.5px] text-content-secondary">
            Extracting TIN, RDO code, and registered tax types…
          </p>
          {hiddenInput}
        </CardContent>
      </Card>
    );
  }

  if (state === "filled") {
    return (
      <Card className="border-success/30 bg-success-bg">
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-success" aria-hidden />
            <div>
              <div className="text-[14px] font-semibold text-navy">
                Auto-filled from COR
              </div>
              <div className="mt-0.5 text-[13px] text-content-secondary">
                {filename || "BIR-COR-2303.pdf"}
              </div>
              <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-content-muted">
                12 fields · 4 tax types
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="link" size="sm" onClick={onBrowse}>
              View current COR
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onRemove}>
              Remove
            </Button>
          </div>
          {hiddenInput}
        </CardContent>
      </Card>
    );
  }

  if (state === "error") {
    return (
      <Card className="border-danger/30 bg-danger-bg">
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <X className="mt-0.5 h-6 w-6 shrink-0 text-danger" aria-hidden />
            <div>
              <div className="text-[14px] font-semibold text-danger-ink">
                Couldn&apos;t read this COR
              </div>
              <p className="mt-0.5 text-[13px] text-content-secondary">
                The file may be blurry or unsupported. Try again or enter the details
                manually.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onBrowse}>
              Try again
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onManual}>
              Enter manually
            </Button>
          </div>
          {hiddenInput}
        </CardContent>
      </Card>
    );
  }

  // empty
  return (
    <Card>
      <CardContent>
        <div className="flex flex-col items-center gap-3 rounded-card border-2 border-dashed border-line-input bg-sidebar/60 px-6 py-10 text-center">
          <UploadCloud className="h-8 w-8 text-gold" aria-hidden />
          <div>
            <div className="text-[14px] font-semibold text-navy">
              Upload BIR COR (2303) — PDF / PNG / JPG
            </div>
            <p className="mt-1 text-[12.5px] text-content-secondary">
              We&apos;ll read the TIN, RDO code, and registered tax types to auto-fill
              this form.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="primary" size="sm" onClick={onBrowse}>
              Browse files
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onError}>
              Simulate read error
            </Button>
          </div>
          {hiddenInput}
        </div>
      </CardContent>
    </Card>
  );
}
