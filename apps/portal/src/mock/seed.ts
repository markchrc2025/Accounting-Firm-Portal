/**
 * Seed data for the MCRC portal mock API.
 *
 * Extracted from the design prototype (`MCRC Portal Prototype.dc.html` — the `Component`
 * class). Realistic Philippine names / TINs / amounts. Enum values are kept EXACT so they
 * round-trip through the frozen `@portal/shared` contract.
 *
 * Money is stored as plain numbers; the `₱1,234,567.00` strings in the prototype were
 * parsed to their numeric values here.
 */
import type {
  Client,
  IncomeTxn,
  ExpenseTxn,
  Filing,
  Invoice,
  FirmUser,
  PortalUser,
  AuditRow,
  Service,
  IntegrationClient,
  DashboardData,
  TaxComputation,
  TaxBracket,
} from "../types";

/* TRAIN-law graduated brackets (reused by tax computations + the Tax Rules editor). */
export const TRAIN_BRACKETS: TaxBracket[] = [
  { over: 0, notOver: 250_000, baseTax: 0, rate: 0 },
  { over: 250_000, notOver: 400_000, baseTax: 0, rate: 15 },
  { over: 400_000, notOver: 800_000, baseTax: 22_500, rate: 20 },
  { over: 800_000, notOver: 2_000_000, baseTax: 102_500, rate: 25 },
  { over: 2_000_000, notOver: 8_000_000, baseTax: 402_500, rate: 30 },
  { over: 8_000_000, notOver: null, baseTax: 2_202_500, rate: 35 },
];

/* ------------------------------------------------------------------------------------- *
 * Clients
 * ------------------------------------------------------------------------------------- */

export const CLIENTS: Client[] = [
  {
    id: "c1",
    name: "Malaya Trading Corp.",
    tradeName: "Malaya Trading",
    filerType: "company",
    tin: "010-582-334-000",
    branchCode: "00000",
    rdoCode: "047",
    regime: "VAT",
    status: "Active",
    classification: "Large",
    citizenship: "Filipino",
    assignedStaff: "A. Reyes",
    city: "Makati City",
    address: "12F Ayala Triangle Tower 2, Paseo de Roxas, Bel-Air",
    zip: "1226",
    email: "ramon@malayatrading.ph",
    phone: "+63 917 555 0142",
    fiscalYearStart: "January",
    seats: 5,
    taxpayerType: "Corporation",
    dateOfIncorporation: "2015-03-18",
    taxTypes: [
      { taxType: "Value-Added Tax", form: "2550Q", frequency: "Quarterly", startDate: "2015-04-01" },
      { taxType: "Income Tax", form: "1701Q", frequency: "Quarterly", startDate: "2015-04-01" },
      { taxType: "Expanded Withholding Tax", form: "0619-E", frequency: "Monthly", startDate: "2015-04-01" },
      { taxType: "Registration Fee", form: "0605", frequency: "Annually", startDate: "2015-04-01" },
    ],
    professionalFee: 25_000,
    billingMethod: "Monthly",
  },
  {
    id: "c2",
    name: "Kape Diwa Coffee Co.",
    tradeName: "Kape Diwa",
    filerType: "company",
    tin: "231-778-105-000",
    branchCode: "00000",
    rdoCode: "039",
    regime: "PERCENTAGE",
    status: "Active",
    classification: "Small",
    citizenship: "Filipino",
    assignedStaff: "J. Santos",
    city: "Quezon City",
    address: "88 Maginhawa Street, Teachers Village East",
    zip: "1101",
    email: "hello@kapediwa.ph",
    phone: "+63 917 222 0781",
    fiscalYearStart: "January",
    seats: 3,
    taxpayerType: "Corporation",
    dateOfIncorporation: "2019-08-05",
    taxTypes: [
      { taxType: "Percentage Tax", form: "2551Q", frequency: "Quarterly", startDate: "2019-09-01" },
      { taxType: "Income Tax", form: "1701Q", frequency: "Quarterly", startDate: "2019-09-01" },
      { taxType: "Expanded Withholding Tax", form: "0619-E", frequency: "Monthly", startDate: "2019-09-01" },
    ],
    professionalFee: 12_000,
    billingMethod: "Monthly",
  },
  {
    id: "c3",
    name: "Bayanihan Builders Inc.",
    filerType: "company",
    tin: "004-119-872-000",
    branchCode: "00000",
    rdoCode: "043",
    regime: "VAT",
    status: "Active",
    classification: "Medium",
    citizenship: "Filipino",
    assignedStaff: "A. Reyes",
    city: "Pasig City",
    fiscalYearStart: "July",
    seats: 8,
    taxpayerType: "Corporation",
    dateOfIncorporation: "2011-01-20",
    taxTypes: [
      { taxType: "Value-Added Tax", form: "2550Q", frequency: "Quarterly", startDate: "2011-02-01" },
      { taxType: "Income Tax", form: "1701Q", frequency: "Quarterly", startDate: "2011-02-01" },
      { taxType: "Expanded Withholding Tax", form: "0619-E", frequency: "Monthly", startDate: "2011-02-01" },
    ],
    professionalFee: 35_000,
    billingMethod: "Monthly",
  },
  {
    id: "c4",
    name: "Luntian Organics OPC",
    filerType: "company",
    tin: "187-263-449-000",
    branchCode: "00000",
    rdoCode: "113",
    regime: "PERCENTAGE",
    status: "Onboarding",
    classification: "Small",
    citizenship: "Filipino",
    assignedStaff: "M. dela Cruz",
    city: "Davao City",
    fiscalYearStart: "January",
    seats: 3,
    taxpayerType: "OPC",
    dateOfIncorporation: "2023-11-09",
    taxTypes: [
      { taxType: "Percentage Tax", form: "2551Q", frequency: "Quarterly", startDate: "2023-12-01" },
      { taxType: "Income Tax", form: "1701Q", frequency: "Quarterly", startDate: "2023-12-01" },
    ],
    professionalFee: 10_000,
    billingMethod: "Quarterly",
  },
  {
    id: "c5",
    name: "Silangan Logistics Corp.",
    filerType: "company",
    tin: "095-441-208-000",
    branchCode: "00000",
    rdoCode: "081",
    regime: "VAT",
    status: "Active",
    classification: "Large",
    citizenship: "Filipino",
    assignedStaff: "J. Santos",
    city: "Cebu City",
    fiscalYearStart: "January",
    seats: 6,
    taxpayerType: "Corporation",
    dateOfIncorporation: "2009-06-30",
    taxTypes: [
      { taxType: "Value-Added Tax", form: "2550Q", frequency: "Quarterly", startDate: "2009-07-01" },
      { taxType: "Income Tax", form: "1701Q", frequency: "Quarterly", startDate: "2009-07-01" },
      { taxType: "Expanded Withholding Tax", form: "0619-E", frequency: "Monthly", startDate: "2009-07-01" },
    ],
    professionalFee: 40_000,
    billingMethod: "Monthly",
  },
  {
    id: "c6",
    name: "Handa Events Studio",
    filerType: "individual",
    tin: "233-902-561-000",
    branchCode: "00000",
    rdoCode: "044",
    regime: "PERCENTAGE",
    status: "Inactive",
    classification: "Small",
    citizenship: "Filipino",
    assignedStaff: "M. dela Cruz",
    city: "Taguig City",
    fiscalYearStart: "January",
    seats: 3,
    lastName: "Aquino",
    firstName: "Isabel",
    middleName: "Reyes",
    dateOfBirth: "1988-02-11",
    civilStatus: "Single",
    taxTypes: [
      { taxType: "Percentage Tax", form: "2551Q", frequency: "Quarterly", startDate: "2020-01-01" },
      { taxType: "Income Tax", form: "1701Q", frequency: "Quarterly", startDate: "2020-01-01" },
    ],
    professionalFee: 8_000,
    billingMethod: "As Filing",
  },
];

/* ------------------------------------------------------------------------------------- *
 * Income transactions — c1 (VAT) and c2 (PERCENTAGE)
 * ------------------------------------------------------------------------------------- */

export const INCOME: IncomeTxn[] = [
  // Malaya Trading Corp. (c1) — VAT
  { id: "in-c1-1042", clientId: "c1", kind: "income", date: "Jun 28, 2026", reference: "SI-1042", customer: "Ayala Property Mgmt Inc.", category: "Consulting Services", vatClass: "VATABLE_12", netAmount: 182_500, period: "2026-Q2", source: "manual" },
  { id: "in-c1-1041", clientId: "c1", kind: "income", date: "Jun 24, 2026", reference: "SI-1041", customer: "Cebu Pacific Cargo", category: "Freight Rebilling", vatClass: "ZERO_RATED", netAmount: 96_400, period: "2026-Q2", source: "manual" },
  { id: "in-c1-1040", clientId: "c1", kind: "income", date: "Jun 20, 2026", reference: "SI-1040", customer: "DepEd Region IV-A", category: "Office Supplies (Gov't)", vatClass: "VATABLE_12", netAmount: 210_000, saleToGov: true, period: "2026-Q2", source: "manual" },
  { id: "in-c1-1039", clientId: "c1", kind: "income", date: "Jun 15, 2026", reference: "SI-1039", customer: "San Miguel Foods Inc.", category: "Trading Goods", vatClass: "VATABLE_12", netAmount: 354_120, period: "2026-Q2", source: "import" },
  { id: "in-c1-1038", clientId: "c1", kind: "income", date: "Jun 09, 2026", reference: "SI-1038", customer: "Brgy. Health Cooperative", category: "Medical Supplies", vatClass: "EXEMPT", netAmount: 48_750, period: "2026-Q2", source: "manual" },
  { id: "in-c1-1037", clientId: "c1", kind: "income", date: "Jun 04, 2026", reference: "SI-1037", customer: "Robinsons Retail Holdings", category: "Trading Goods", vatClass: "VATABLE_12", netAmount: 268_300, period: "2026-Q2", source: "import" },
  { id: "in-c1-1036", clientId: "c1", kind: "income", date: "May 30, 2026", reference: "SI-1036", customer: "Shopee PH Marketplace", category: "Online Sales", vatClass: "VATABLE_12", netAmount: 131_980, period: "2026-Q2", source: "import" },
  { id: "in-c1-1035", clientId: "c1", kind: "income", date: "May 26, 2026", reference: "SI-1035", customer: "JICA Development Project", category: "Consulting Services", vatClass: "ZERO_RATED", netAmount: 75_000, period: "2026-Q2", source: "manual" },

  // Kape Diwa Coffee Co. (c2) — PERCENTAGE (gross receipts, always NON_VAT)
  { id: "in-c2-0788", clientId: "c2", kind: "income", date: "Jun 30, 2026", reference: "OR-0788", customer: "Walk-in sales (Z-reading)", category: "Store Sales", vatClass: "NON_VAT", netAmount: 64_850, period: "2026-Q2", source: "manual" },
  { id: "in-c2-0787", clientId: "c2", kind: "income", date: "Jun 27, 2026", reference: "OR-0787", customer: "Acceler8 BGC — catering", category: "Catering", vatClass: "NON_VAT", netAmount: 48_200, period: "2026-Q2", source: "manual" },
  { id: "in-c2-0786", clientId: "c2", kind: "income", date: "Jun 21, 2026", reference: "OR-0786", customer: "Café Ilustrado — wholesale beans", category: "Wholesale", vatClass: "NON_VAT", netAmount: 82_500, period: "2026-Q2", source: "manual" },
  { id: "in-c2-0785", clientId: "c2", kind: "income", date: "Jun 15, 2026", reference: "OR-0785", customer: "Walk-in sales (Z-reading)", category: "Store Sales", vatClass: "NON_VAT", netAmount: 58_340, period: "2026-Q2", source: "manual" },
  { id: "in-c2-0784", clientId: "c2", kind: "income", date: "Jun 08, 2026", reference: "OR-0784", customer: "GrabFood payouts", category: "Delivery Sales", vatClass: "NON_VAT", netAmount: 37_610, period: "2026-Q2", source: "import" },
  { id: "in-c2-0783", clientId: "c2", kind: "income", date: "May 31, 2026", reference: "OR-0783", customer: "Walk-in sales (Z-reading)", category: "Store Sales", vatClass: "NON_VAT", netAmount: 61_420, period: "2026-Q2", source: "manual" },
  { id: "in-c2-0782", clientId: "c2", kind: "income", date: "May 24, 2026", reference: "OR-0782", customer: "Teambuilding — Nestlé PH", category: "Catering", vatClass: "NON_VAT", netAmount: 72_000, period: "2026-Q2", source: "manual" },
  { id: "in-c2-0781", clientId: "c2", kind: "income", date: "May 17, 2026", reference: "OR-0781", customer: "Lazada online orders", category: "Online Sales", vatClass: "NON_VAT", netAmount: 61_400, period: "2026-Q2", source: "import" },
];

/* ------------------------------------------------------------------------------------- *
 * Expense transactions — c1 (VAT) and c2 (PERCENTAGE)
 * ------------------------------------------------------------------------------------- */

export const EXPENSES: ExpenseTxn[] = [
  // Malaya Trading Corp. (c1) — VAT (input VAT tracked)
  { id: "ex-c1-0871", clientId: "c1", kind: "expense", date: "Jun 27, 2026", reference: "EXP-0871", supplier: "Meralco", category: "Utilities", inputVatCategory: "DOMESTIC_PURCHASES", inputTaxAttribution: "VATABLE", deductible: true, amount: 42_180, period: "2026-Q2", source: "manual" },
  { id: "ex-c1-0870", clientId: "c1", kind: "expense", date: "Jun 25, 2026", reference: "EXP-0870", supplier: "AWS (non-resident)", category: "Software Services", inputVatCategory: "SERVICES_NONRESIDENT", inputTaxAttribution: "VATABLE", deductible: true, amount: 38_400, period: "2026-Q2", source: "manual" },
  { id: "ex-c1-0869", clientId: "c1", kind: "expense", date: "Jun 18, 2026", reference: "EXP-0869", supplier: "Hino Motors Philippines", category: "Delivery Truck", inputVatCategory: "CAPITAL_GOODS_GT_1M", inputTaxAttribution: "VATABLE", deductible: true, amount: 1_850_000, usefulLifeMonths: 60, period: "2026-Q2", source: "manual" },
  { id: "ex-c1-0868", clientId: "c1", kind: "expense", date: "Jun 12, 2026", reference: "EXP-0868", supplier: "Bureau of Customs — MICP", category: "Imported Inventory", inputVatCategory: "IMPORTATION_GOODS", inputTaxAttribution: "VATABLE", deductible: true, amount: 214_600, period: "2026-Q2", source: "import" },
  { id: "ex-c1-0867", clientId: "c1", kind: "expense", date: "Jun 08, 2026", reference: "EXP-0867", supplier: "Landbank service charges", category: "Bank Fees", inputVatCategory: "DOMESTIC_NO_INPUT_TAX", inputTaxAttribution: "VATABLE", deductible: true, amount: 1_240, period: "2026-Q2", source: "manual" },
  { id: "ex-c1-0866", clientId: "c1", kind: "expense", date: "Jun 03, 2026", reference: "EXP-0866", supplier: "Team offsite — Antipolo", category: "Entertainment", inputVatCategory: "DOMESTIC_PURCHASES", inputTaxAttribution: "MIXED", deductible: false, amount: 18_750, period: "2026-Q2", source: "manual" },

  // Kape Diwa Coffee Co. (c2) — PERCENTAGE (input VAT NOT tracked → null category)
  { id: "ex-c2-0442", clientId: "c2", kind: "expense", date: "Jun 30, 2026", reference: "EXP-0442", supplier: "JG Realty — QC branch", category: "Rent", inputVatCategory: null, inputTaxAttribution: null, deductible: true, amount: 45_000, period: "2026-Q2", source: "manual" },
  { id: "ex-c2-0441", clientId: "c2", kind: "expense", date: "Jun 26, 2026", reference: "EXP-0441", supplier: "Bote Central (green beans)", category: "Ingredients", inputVatCategory: null, inputTaxAttribution: null, deductible: true, amount: 38_750, period: "2026-Q2", source: "manual" },
  { id: "ex-c2-0440", clientId: "c2", kind: "expense", date: "Jun 19, 2026", reference: "EXP-0440", supplier: "Meralco", category: "Utilities", inputVatCategory: null, inputTaxAttribution: null, deductible: true, amount: 12_180, period: "2026-Q2", source: "manual" },
  { id: "ex-c2-0439", clientId: "c2", kind: "expense", date: "Jun 14, 2026", reference: "EXP-0439", supplier: "Crew payroll — 1st half Jun", category: "Wages", inputVatCategory: null, inputTaxAttribution: null, deductible: true, amount: 86_400, period: "2026-Q2", source: "manual" },
  { id: "ex-c2-0438", clientId: "c2", kind: "expense", date: "Jun 07, 2026", reference: "EXP-0438", supplier: "Shopify subscription", category: "Software", inputVatCategory: null, inputTaxAttribution: null, deductible: true, amount: 2_100, period: "2026-Q2", source: "import" },
  { id: "ex-c2-0437", clientId: "c2", kind: "expense", date: "Jun 02, 2026", reference: "EXP-0437", supplier: "Owner's personal groceries", category: "Other", inputVatCategory: null, inputTaxAttribution: null, deductible: false, amount: 4_320, period: "2026-Q2", source: "manual" },
];

/* ------------------------------------------------------------------------------------- *
 * BIR Filings — c1 (VAT: 2550Q) and c2 (PERCENTAGE: 2551Q)
 * ------------------------------------------------------------------------------------- */

export const FILINGS: Filing[] = [
  // c1 — VAT
  { id: "fl-c1-1", clientId: "c1", form: "2550Q", period: "Q1 2026 · Quarterly VAT return", filed: "Apr 24, 2026", reference: "EFPS-882314", status: "Accepted" },
  { id: "fl-c1-2", clientId: "c1", form: "1701Q", period: "Q1 2026 · Quarterly income tax", filed: "May 14, 2026", reference: "EFPS-871203", status: "Accepted" },
  { id: "fl-c1-3", clientId: "c1", form: "0619-E", period: "May 2026 · Expanded withholding", filed: "Jun 09, 2026", reference: "EFPS-893441", status: "Accepted" },
  { id: "fl-c1-4", clientId: "c1", form: "0619-E", period: "Apr 2026 · Expanded withholding", filed: "May 08, 2026", reference: "EFPS-864102", status: "Accepted" },
  { id: "fl-c1-5", clientId: "c1", form: "2550Q", period: "Q4 2025 · Quarterly VAT return", filed: "Jan 23, 2026", reference: "EFPS-812276", status: "Accepted" },
  { id: "fl-c1-6", clientId: "c1", form: "1701", period: "FY 2025 · Annual income tax", filed: "Apr 12, 2026", reference: "EFPS-855910", status: "Amended" },
  // c2 — PERCENTAGE
  { id: "fl-c2-1", clientId: "c2", form: "2551Q", period: "Q1 2026 · Quarterly percentage tax", filed: "Apr 22, 2026", reference: "EFPS-880071", status: "Accepted" },
  { id: "fl-c2-2", clientId: "c2", form: "1701Q", period: "Q1 2026 · Quarterly income tax", filed: "May 12, 2026", reference: "EFPS-869930", status: "Accepted" },
  { id: "fl-c2-3", clientId: "c2", form: "0619-E", period: "May 2026 · Expanded withholding", filed: "Jun 08, 2026", reference: "EFPS-893002", status: "Accepted" },
  { id: "fl-c2-4", clientId: "c2", form: "2551Q", period: "Q4 2025 · Quarterly percentage tax", filed: "Jan 21, 2026", reference: "EFPS-810944", status: "Accepted" },
  { id: "fl-c2-5", clientId: "c2", form: "1701", period: "FY 2025 · Annual income tax", filed: "Apr 10, 2026", reference: "EFPS-854128", status: "Accepted" },
];

/* ------------------------------------------------------------------------------------- *
 * Invoices (firm billing — all against c1 in the prototype)
 * ------------------------------------------------------------------------------------- */

export const INVOICES: Invoice[] = [
  {
    id: "inv-041",
    number: "INV-2026-041",
    clientId: "c1",
    description: "Monthly accounting retainer — Jun",
    issued: "Jul 01, 2026",
    due: "Jul 15, 2026",
    amount: 25_000,
    status: "Sent",
    lineItems: [
      { description: "Monthly accounting retainer — Jul 2026", qty: 1, rate: 25_000, amount: 25_000 },
      { description: "Q2 2550Q preparation & e-filing", qty: 1, rate: 8_500, amount: 8_500 },
      { description: "Additional bookkeeping hours", qty: 4, rate: 1_000, amount: 4_000 },
    ],
  },
  { id: "inv-036", number: "INV-2026-036", clientId: "c1", description: "Q1 VAT filing & bookkeeping", issued: "Jun 01, 2026", due: "Jun 15, 2026", amount: 42_000, status: "Paid", lineItems: [{ description: "Q1 VAT filing & bookkeeping", qty: 1, rate: 42_000, amount: 42_000 }] },
  { id: "inv-031", number: "INV-2026-031", clientId: "c1", description: "Monthly accounting retainer — May", issued: "May 01, 2026", due: "May 15, 2026", amount: 25_000, status: "Paid", lineItems: [{ description: "Monthly accounting retainer — May", qty: 1, rate: 25_000, amount: 25_000 }] },
  { id: "inv-027", number: "INV-2026-027", clientId: "c1", description: "Payroll setup — one-time", issued: "Apr 12, 2026", due: "Apr 26, 2026", amount: 18_500, status: "Overdue", lineItems: [{ description: "Payroll setup — one-time", qty: 1, rate: 18_500, amount: 18_500 }] },
  { id: "inv-024", number: "INV-2026-024", clientId: "c1", description: "Monthly accounting retainer — Apr", issued: "Apr 01, 2026", due: "Apr 15, 2026", amount: 25_000, status: "Paid", lineItems: [{ description: "Monthly accounting retainer — Apr", qty: 1, rate: 25_000, amount: 25_000 }] },
];

/* ------------------------------------------------------------------------------------- *
 * Firm users + portal users
 * ------------------------------------------------------------------------------------- */

export const FIRM_USERS: FirmUser[] = [
  { id: "u1", name: "Marielle Reyes-Cruz", email: "m.reyescruz@mcrc.ph", role: "Super Admin", mfa: "Enrolled", status: "Active" },
  { id: "u2", name: "Alvin Reyes", email: "a.reyes@mcrc.ph", role: "Manager", mfa: "Enrolled", status: "Active" },
  { id: "u3", name: "Joanna Santos", email: "j.santos@mcrc.ph", role: "Accountant", mfa: "Enrolled", status: "Active" },
  { id: "u4", name: "Mika dela Cruz", email: "m.delacruz@mcrc.ph", role: "Bookkeeper", mfa: "Pending", status: "Invited" },
  { id: "u5", name: "Paolo Garcia", email: "p.garcia@mcrc.ph", role: "Auditor", mfa: "Enrolled", status: "Active" },
];

export const PORTAL_USERS: PortalUser[] = [
  { id: "pu1", clientId: "c1", name: "Ramon Villanueva", email: "ramon@malayatrading.ph", role: "Owner", status: "Active" },
  { id: "pu2", clientId: "c1", name: "Lea Villanueva", email: "lea@malayatrading.ph", role: "Manager", status: "Active" },
  { id: "pu3", clientId: "c1", name: "Carlo Mendoza", email: "carlo.m@malayatrading.ph", role: "Viewer", status: "Invited" },
  { id: "pu4", clientId: "c2", name: "Diwa Salazar", email: "diwa@kapediwa.ph", role: "Owner", status: "Active" },
  { id: "pu5", clientId: "c2", name: "Ben Ocampo", email: "ben@kapediwa.ph", role: "Viewer", status: "Active" },
];

/* ------------------------------------------------------------------------------------- *
 * Audit log (immutable; includes the BIR Form Generator integration actor)
 * ------------------------------------------------------------------------------------- */

export const AUDIT: AuditRow[] = [
  { id: "a1", timestamp: "2026-07-10 17:42:11", actor: "Joanna Santos", action: "create", entity: "Transaction batch (214) — Silangan Logistics", ip: "112.198.44.10" },
  { id: "a2", timestamp: "2026-07-10 16:05:33", actor: "BIR Form Generator", action: "export", entity: "Q2 aggregates — Malaya Trading Corp.", ip: "52.74.121.88" },
  { id: "a3", timestamp: "2026-07-10 14:18:02", actor: "Marielle Reyes-Cruz", action: "update", entity: "Tax rules — Bayanihan Builders Inc.", ip: "112.198.44.10" },
  { id: "a4", timestamp: "2026-07-10 11:51:47", actor: "Ramon Villanueva", action: "create", entity: "Income record SI-1042 — Malaya Trading", ip: "49.145.7.203" },
  { id: "a5", timestamp: "2026-07-10 09:24:19", actor: "Alvin Reyes", action: "login", entity: "Session — MFA verified", ip: "112.198.44.10" },
  { id: "a6", timestamp: "2026-07-09 18:33:56", actor: "Mika dela Cruz", action: "update", entity: "Client — Luntian Organics OPC", ip: "124.106.18.77" },
  { id: "a7", timestamp: "2026-07-09 15:07:28", actor: "BIR Form Generator", action: "create", entity: "Filed 2550Q Q1 2026 — Malaya Trading", ip: "52.74.121.88" },
  { id: "a8", timestamp: "2026-07-09 10:42:05", actor: "Marielle Reyes-Cruz", action: "delete", entity: "Draft invoice INV-2026-040", ip: "112.198.44.10" },
  { id: "a9", timestamp: "2026-07-08 16:20:44", actor: "Paolo Garcia", action: "export", entity: "Audit log CSV — Jun 2026", ip: "112.198.44.10" },
  { id: "a10", timestamp: "2026-07-08 09:03:12", actor: "Joanna Santos", action: "login", entity: "Session — MFA verified", ip: "203.177.55.9" },
];

/* ------------------------------------------------------------------------------------- *
 * Services catalog
 * ------------------------------------------------------------------------------------- */

export const SERVICES: Service[] = [
  { id: "sv1", name: "Monthly Accounting Retainer", description: "Bookkeeping, reconciliations, and monthly reports", defaultFee: 25_000, billingMethod: "Monthly", status: "Active", linkedForm: null },
  { id: "sv2", name: "Quarterly VAT Filing (2550Q)", description: "Preparation and e-filing of quarterly VAT return", defaultFee: 8_500, billingMethod: "As Filing", status: "Active", linkedForm: "2550Q" },
  { id: "sv3", name: "Percentage Tax Filing (2551Q)", description: "Preparation and e-filing of quarterly percentage tax", defaultFee: 6_000, billingMethod: "As Filing", status: "Active", linkedForm: "2551Q" },
  { id: "sv4", name: "Annual Income Tax Return (1701)", description: "Year-end computation, preparation, and filing", defaultFee: 18_000, billingMethod: "As Filing", status: "Active", linkedForm: "1701" },
  { id: "sv5", name: "Payroll Processing", description: "Per-cutoff payroll runs incl. government remittances", defaultFee: 12_000, billingMethod: "Monthly", status: "Active", linkedForm: null },
  { id: "sv6", name: "Business Registration Assistance", description: "BIR, LGU, and SEC/DTI registration support", defaultFee: 15_000, billingMethod: "Quarterly", status: "Retired", linkedForm: null },
];

/* ------------------------------------------------------------------------------------- *
 * Integration credentials (OAuth2 client-credentials)
 * ------------------------------------------------------------------------------------- */

export const INTEGRATIONS: IntegrationClient[] = [
  {
    id: "int1",
    name: "BIR Form Generator",
    status: "Active",
    clientKey: "mcrc_bir_live_9f21c7a4e8b3",
    clientSecret: "mock-demo-secret-bir-generator-reveal-once",
    scopes: ["aggregates:read", "filings:write", "clients:read"],
    lastUsed: "2026-07-10 16:05:33",
  },
  {
    id: "int2",
    name: "Payroll Sync (staging)",
    status: "Disabled",
    clientKey: "mcrc_payroll_stg_0b1d4e6f8a2c",
    clientSecret: "mock-demo-secret-payroll-staging-reveal-once",
    scopes: ["clients:read"],
  },
];

/* ------------------------------------------------------------------------------------- *
 * Dashboard aggregates (firm portfolio, FY 2026)
 * ------------------------------------------------------------------------------------- */

export const DASHBOARD: DashboardData = {
  kpis: [
    { label: "Portfolio income", value: 8_642_300, isCurrency: true, delta: "+12.4% vs last quarter" },
    { label: "Portfolio expenses", value: 5_218_770, isCurrency: true, delta: "+6.1% vs last quarter" },
    { label: "Active clients", value: 4, isCurrency: false, delta: "6 total · 4 active" },
    { label: "Filings due this month", value: 5, isCurrency: false, delta: "3 urgent" },
  ],
  incomeVsExpenses: [
    { month: "Jan", income: 1_180_400, expenses: 742_100 },
    { month: "Feb", income: 1_042_900, expenses: 690_300 },
    { month: "Mar", income: 1_356_200, expenses: 912_450 },
    { month: "Apr", income: 1_489_700, expenses: 878_200 },
    { month: "May", income: 1_311_050, expenses: 826_540 },
    { month: "Jun", income: 1_562_050, expenses: 1_169_180 },
  ],
  recentActivity: [
    { id: "act1", initials: "JS", text: "Joanna Santos imported 214 sales records for Silangan Logistics Corp.", time: "24 MIN AGO" },
    { id: "act2", initials: "BG", text: "BIR Form Generator pushed filed 2550Q (Q1 2026) for Malaya Trading Corp.", time: "1 HR AGO" },
    { id: "act3", initials: "AR", text: "Alvin Reyes approved 12 expense records for Bayanihan Builders Inc.", time: "3 HRS AGO" },
    { id: "act4", initials: "RV", text: "Ramon Villanueva (client) added ₱182,500.00 income — Malaya Trading Corp.", time: "YESTERDAY" },
    { id: "act5", initials: "MD", text: "Mika dela Cruz invited owner@luntianorganics.ph to the Client Portal.", time: "YESTERDAY" },
  ],
  upcomingFilings: [
    { id: "up1", form: "2550Q", client: "Malaya Trading Corp.", period: "Q2 2026 · VAT return", due: "DUE JUL 25", urgency: "urgent" },
    { id: "up2", form: "2551Q", client: "Kape Diwa Coffee Co.", period: "Q2 2026 · Percentage tax", due: "DUE JUL 25", urgency: "urgent" },
    { id: "up3", form: "0619-E", client: "Bayanihan Builders Inc.", period: "Jun 2026 · Expanded WHT", due: "DUE AUG 10", urgency: "normal" },
    { id: "up4", form: "2550Q", client: "Silangan Logistics Corp.", period: "Q2 2026 · VAT return", due: "DUE JUL 25", urgency: "urgent" },
    { id: "up5", form: "1701Q", client: "Luntian Organics OPC", period: "Q2 2026 · Income tax", due: "DUE AUG 15", urgency: "normal" },
  ],
  regimeMix: { vat: 3, percentage: 3 },
};

/* ------------------------------------------------------------------------------------- *
 * Tax computations (in-app ESTIMATE — authoritative figure comes from the Generator)
 * ------------------------------------------------------------------------------------- */

export const TAX_COMPUTATIONS: Record<string, TaxComputation> = {
  c1: {
    clientId: "c1",
    period: "2026-Q2",
    grossIncome: 1_367_050,
    deductions: 315_170,
    taxableIncome: 1_051_880,
    brackets: TRAIN_BRACKETS,
    estimatedTaxDue: 165_470,
    filed: { form: "1701Q", figure: 158_920, filedDate: "May 14, 2026", status: "Accepted by eFPS" },
    variance: 6_550,
  },
  c2: {
    clientId: "c2",
    period: "2026-Q2",
    grossIncome: 486_320,
    deductions: 184_430,
    taxableIncome: 301_890,
    brackets: TRAIN_BRACKETS,
    estimatedTaxDue: 7_783,
    filed: { form: "1701Q", figure: 7_783, filedDate: "May 12, 2026", status: "Accepted by eFPS" },
    variance: 0,
  },
};
