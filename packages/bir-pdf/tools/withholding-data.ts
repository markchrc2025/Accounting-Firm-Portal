// withholding-data.ts — DEV ONLY. The invented drafts the 0619-E, 1601-EQ and 1601-C
// fixtures and proofs are made from (C9, D57). make-fixtures.ts writes them out through the
// Portal's own builder (apps/api bir-forms/engine/withholding-print.ts); the C9 tests read
// them from here to build their refusal cases. Invented taxpayers and figures only: no real
// TIN, name, address, phone or e-mail.
import type { FilingData, Taxpayer } from "../../../apps/api/src/bir-forms/engine/index";

/** An invented corporate withholding agent (signs on the For Non-Individual side). */
export const WH_CORPORATION: Taxpayer = {
  id: "wh-corporation",
  kind: "non-individual",
  regName: "INVENTED SAMPLE TRADING CORPORATION",
  lastName: "",
  firstName: "",
  middleName: "",
  tin: "123-456-789",
  branch: "00000",
  rdo: "044",
  address: "12 INVENTED STREET, BARANGAY HALIMBAWA",
  city: "LUNGSOD NG HALIMBAWA",
  zip: "1234",
  birthdate: "",
  email: "",
  phone: "",
  citizenship: "",
  civilStatus: "",
  taxpayerType: "",
  classification: "Micro",
  createdAt: 0,
};

/** An invented individual withholding agent (signs on the For Individual side). */
export const WH_INDIVIDUAL: Taxpayer = {
  ...WH_CORPORATION,
  id: "wh-individual",
  kind: "individual",
  regName: "",
  lastName: "SAMPLE",
  firstName: "TESTA",
  middleName: "INVENTED",
  tin: "987-654-321",
  branch: "00001",
  rdo: "050",
  address: "8 SAMPLE AVENUE",
  city: "SAMPLE CITY",
  zip: "5678",
  classification: "Single Proprietorship",
};

export interface WhSample {
  form: "0619E" | "1601EQ" | "1601C";
  period: string;
  taxpayer: Taxpayer;
  data: FilingData;
}

/** The signature, tax agent and payment boxes every return shares, all filled. */
const SIGN_AND_PAY: FilingData = {
  signatoryName: "DELA CRUZ, TESTA SAMPLE",
  signatoryTitle: "PRESIDENT",
  signatoryTin: "111-222-333-00000",
  taxAgentNo: "TA-0001",
  taxAgentIssueDate: "2025-01-15",
  taxAgentExpiryDate: "2028-01-14",
  payCashBank: "SAMPLE BANK",
  payCashNumber: "BDM-0001",
  payCashDate: "2026-09-09",
  payCashAmount: "12345.67",
  payCheckBank: "SAMPLE BNK",
  payCheckNumber: "CHK-000123",
  payCheckDate: "2026-09-08",
  payCheckAmount: "1000.10",
  payTaxDebitBank: "NOT PRINTED",
  payTaxDebitNumber: "TDM-0001",
  payTaxDebitDate: "2026-09-07",
  payTaxDebitAmount: "200.02",
  payOthersSpecify: "GCASH",
  payOthersBank: "SAMPLE",
  payOthersNumber: "OP-0001",
  payOthersDate: "2026-09-06",
  payOthersAmount: "30.03",
};

// 0619-E, August 2026: a corporation; the books' remittance and a bank payment.
const s0619E: WhSample = {
  form: "0619E",
  period: "2026-08",
  taxpayer: WH_CORPORATION,
  data: {
    year: "2026",
    month: "08",
    dueDate: "2026-09-10",
    amended: "no",
    anyWithheld: "yes",
    category: "private",
    contact: "0917-000-0000",
    email: "accounts@invented-sample.example",
    remittance: "12345.67",
    ...SIGN_AND_PAY,
    payCheckAmount: "",
    payCheckBank: "",
    payCheckNumber: "",
    payCheckDate: "",
    payTaxDebitAmount: "",
    payTaxDebitBank: "",
    payTaxDebitNumber: "",
    payTaxDebitDate: "",
    payOthersSpecify: "",
    payOthersBank: "",
    payOthersNumber: "",
    payOthersDate: "",
    payOthersAmount: "",
  },
};

// 0619-E with penalties and every kind of payment: an amended return by an individual.
const s0619EPenalties: WhSample = {
  form: "0619E",
  period: "2026-05",
  taxpayer: WH_INDIVIDUAL,
  data: {
    year: "2026",
    month: "05",
    dueDate: "2026-06-10",
    amended: "yes",
    anyWithheld: "yes",
    category: "private",
    contact: "09180000000",
    email: "sample.testa@example.com",
    remittance: "12,345.67",
    previouslyRemitted: "1000.00",
    surcharge: "2,836.42",
    interest: "257.20",
    compromise: "1000.00",
    ...SIGN_AND_PAY,
  },
};

// 1601-EQ, Q3 2026: an individual; three ATC rows (commas as typed, a rate 0.5), the 1st
// and 2nd month remittances, an unremitted balance and a check.
const s1601EQ: WhSample = {
  form: "1601EQ",
  period: "2026-Q3",
  taxpayer: WH_INDIVIDUAL,
  data: {
    year: "2026",
    quarter: "3rd",
    anyWithheld: "yes",
    sheetsAttached: "1",
    category: "private",
    contact: "09180000000",
    email: "sample.testa@example.com",
    rows: [
      { atc: "WC158", base: "100000.00", rate: "1", withheld: "1000.00" },
      { atc: "WI010", base: "50,000.50", rate: "5", withheld: "2,500.03" },
      { atc: "WC050", base: "20000.00", rate: "0.5", withheld: "100.00" },
    ],
    remittance1: "1500.00",
    remittance2: "1200.00",
    surcharge: "",
    interest: "",
    compromise: "",
    ...SIGN_AND_PAY,
  },
};

// 1601-EQ with all six ATC rows, the largest figures its boxes hold, and penalties.
const s1601EQSix: WhSample = {
  form: "1601EQ",
  period: "2026-Q2",
  taxpayer: WH_CORPORATION,
  data: {
    year: "2026",
    quarter: "2nd",
    amended: "yes",
    anyWithheld: "yes",
    sheetsAttached: "12",
    category: "government",
    contact: "(02) 8000 0000",
    email: "payables@invented-sample.example",
    rows: [
      { atc: "WC158", base: "123456789.01", rate: "1", withheld: "1234567.89" },
      { atc: "WC160", base: "9876543.21", rate: "2", withheld: "197530.86" },
      { atc: "WI010", base: "5555555.55", rate: "5", withheld: "277777.78" },
      { atc: "WI011", base: "4444444.44", rate: "10", withheld: "444444.44" },
      { atc: "WC010", base: "3333333.33", rate: "10", withheld: "333333.33" },
      { atc: "WI100", base: "2222222.22", rate: "5", withheld: "111111.11" },
    ],
    remittance1: "400000.00",
    remittance2: "350000.50",
    previouslyRemitted: "10000.00",
    overRemittancePrior: "5000.25",
    otherPayments: "20000.00",
    surcharge: "30000.00",
    interest: "4000.40",
    compromise: "2000.00",
    ...SIGN_AND_PAY,
  },
};

// 1601-C, August 2026: a corporation; the specify lines, tax relief and one remittance.
const s1601C: WhSample = {
  form: "1601C",
  period: "2026-08",
  taxpayer: WH_CORPORATION,
  data: {
    year: "2026",
    month: "08",
    amended: "no",
    anyWithheld: "yes",
    sheetsAttached: "1",
    category: "private",
    contact: "0917-000-0000",
    email: "hr.payroll@invented-sample.example",
    reliefYesNo: "yes",
    reliefSpecify: "PH-JP TREATY",
    compensation: "250,000.00",
    mwe: "20000.00",
    holiday: "1500.50",
    thirteenth: "10000.00",
    deMinimis: "2500.00",
    contributions: "9500.25",
    otherNonTaxable: "1000.00",
    otherNonTaxableSpecify: "TRANSPORTATION",
    notSubjectToWithholding: "0.00",
    taxesWithheld: "15000.00",
    previouslyRemitted: "",
    otherRemittances: "500.00",
    otherRemittancesSpecify: "ADVANCE REMITTANCE",
    ...SIGN_AND_PAY,
  },
};

// 1601-C with the three Schedule I rows (each a month paid short, so each adjustment is
// positive) and penalties, by an individual.
const s1601CSchedule: WhSample = {
  form: "1601C",
  period: "2026-09",
  taxpayer: WH_INDIVIDUAL,
  data: {
    ...s1601C.data,
    month: "09",
    amended: "yes",
    previouslyRemitted: "2000.00",
    reliefYesNo: "no",
    reliefSpecify: "",
    surcharge: "100.10",
    interest: "50.05",
    compromise: "200.00",
    scheduleRows: [
      {
        month: "2026-05",
        datePaid: "2026-06-10",
        bank: "SAMPLE BANK",
        number: "CHK-001",
        taxPaid: "1000.00",
        shouldBe: "1250.75",
      },
      {
        month: "2026-06",
        datePaid: "2026-07-10",
        bank: "SAMPLE BNK",
        number: "CHK-002",
        taxPaid: "2000.50",
        shouldBe: "2100.55",
      },
      {
        month: "2026-07",
        datePaid: "2026-08-10",
        bank: "SAMPLE BANK",
        number: "CHK-003",
        taxPaid: "3000.00",
        shouldBe: "3000.99",
      },
    ],
  },
};

/** fixture file name (without .json) → the draft it is made from. */
export const WH_SAMPLES: Record<string, WhSample> = {
  "0619E-sample": s0619E,
  "0619E-penalties": s0619EPenalties,
  "1601EQ-sample": s1601EQ,
  "1601EQ-six-rows": s1601EQSix,
  "1601C-sample": s1601C,
  "1601C-schedule": s1601CSchedule,
};
