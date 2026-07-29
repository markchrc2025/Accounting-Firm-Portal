/**
 * The BIR form catalog for the internal Generator (ported from the Sentire BIR
 * Form Generator, which implements all nine). `status` tracks the in-portal
 * rollout: "planned" until the form's compute + XML + UI have been ported.
 * 2551Q is the first form being brought over (Phase 1/2).
 */
export type BirFormStatus = "available" | "planned";

export interface BirFormCatalogItem {
  code: string;
  title: string;
  frequency: string;
  category: string;
  description: string;
  status: BirFormStatus;
  /**
   * Whether the form produces an eBIRForms XML artifact. The 2307 / 2316
   * certificates are issued to a payee / employee rather than e-filed, so BIR
   * defines no XML for them — they are printed as an A4 PDF instead.
   */
  xmlExport: boolean;
}

export const BIR_FORM_CATALOG: BirFormCatalogItem[] = [
  {
    code: "2551Q",
    title: "Quarterly Percentage Tax Return",
    frequency: "Quarterly",
    category: "Percentage Tax",
    description: "Non-VAT taxpayers — percentage tax on gross receipts/sales.",
    xmlExport: true,
    status: "available",
  },
  {
    code: "2550Q",
    title: "Quarterly Value-Added Tax Return",
    frequency: "Quarterly",
    category: "VAT",
    description: "VAT-registered taxpayers — output/input VAT for the quarter.",
    xmlExport: true,
    status: "available",
  },
  {
    code: "1701Q",
    title: "Quarterly Income Tax Return (Individuals)",
    frequency: "Quarterly",
    category: "Income Tax",
    description: "Self-employed individuals / professionals — quarterly income tax.",
    xmlExport: true,
    status: "available",
  },
  {
    code: "1701",
    title: "Annual Income Tax Return (Individuals)",
    frequency: "Annual",
    category: "Income Tax",
    description: "Individuals earning income from business/profession.",
    xmlExport: true,
    status: "available",
  },
  {
    code: "1701A",
    title: "Annual Income Tax Return (8% / OSD)",
    frequency: "Annual",
    category: "Income Tax",
    description: "Individuals under the 8% flat rate or optional standard deduction.",
    xmlExport: true,
    status: "available",
  },
  {
    code: "1702Q",
    title: "Quarterly Income Tax Return (Corporations)",
    frequency: "Quarterly",
    category: "Income Tax",
    description: "Corporations / partnerships — quarterly income tax.",
    xmlExport: true,
    status: "available",
  },
  {
    code: "1702RT",
    title: "Annual Income Tax Return (Corporations, Regular)",
    frequency: "Annual",
    category: "Income Tax",
    description: "Corporations subject to the regular income-tax rate.",
    xmlExport: true,
    status: "available",
  },
  {
    code: "2307",
    title: "Certificate of Creditable Tax Withheld at Source",
    frequency: "Per transaction",
    category: "Withholding",
    description: "Creditable withholding tax certificate issued to payees.",
    xmlExport: false,
    status: "available",
  },
  {
    code: "2316",
    title: "Certificate of Compensation Payment / Tax Withheld",
    frequency: "Annual",
    category: "Withholding",
    description: "Compensation and tax withheld certificate for employees.",
    xmlExport: false,
    status: "available",
  },
];
