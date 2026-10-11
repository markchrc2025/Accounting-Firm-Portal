// make-fixtures.ts — DEV ONLY. Writes the committed sample exports in fixtures/
// by running the Portal's own eBIRForms builders (read-only use of
// apps/api/src/bir-forms/engine) for an INVENTED taxpayer and invented figures.
//
//   pnpm --filter @portal/bir-pdf fixtures
//
// The fixtures are what the T1/T2 tests render, so the engine is always proven
// against the exact bytes the Portal emits, not a hand-written imitation.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  build1701,
  build1701Q,
  build1702Q,
  build2550Q,
  build2551Q,
  compute1701,
  compute1701Q,
  compute1702Q,
  compute2550Q,
  compute2551Q,
  type Filing,
  type Taxpayer,
} from "../../../apps/api/src/bir-forms/engine/index";

const here = dirname(fileURLToPath(import.meta.url));

/** The invented taxpayer every fixture and proof uses. Never a real client. */
export const TEST_TAXPAYER: Taxpayer = {
  id: "test-taxpayer",
  kind: "non-individual",
  regName: "TEST TAXPAYER",
  lastName: "",
  firstName: "",
  middleName: "",
  tin: "123-456-789",
  branch: "00000",
  rdo: "000",
  address: "1 SAMPLE STREET",
  city: "SAMPLE CITY",
  zip: "0000",
  birthdate: "",
  email: "test.taxpayer@example.com",
  phone: "0000000",
  citizenship: "",
  civilStatus: "",
  taxpayerType: "",
  classification: "Micro",
  createdAt: 0,
};

/** The invented individual the 1701Q, 1701A and 1701 fixtures use. Never a real person. */
export const TEST_INDIVIDUAL: Taxpayer = {
  ...TEST_TAXPAYER,
  id: "test-individual",
  kind: "individual",
  regName: "",
  lastName: "TAXPAYER",
  firstName: "TEST",
  middleName: "SAMPLE",
  birthdate: "1980-01-15",
  citizenship: "FILIPINO",
  phone: "09170000000",
  civilStatus: "married",
  taxpayerType: "Self-employed",
};

function filing(
  form: Filing["form"],
  data: Filing["data"],
  period = "2026-Q3",
  taxpayer: Taxpayer = TEST_TAXPAYER,
): Filing {
  return {
    id: `fixture-${form}`,
    form,
    taxpayerId: taxpayer.id,
    status: "filed",
    period,
    data,
    createdAt: 0,
    updatedAt: 0,
  };
}

// 2551Q, Q3 2026: a two-row Schedule 1 and one creditable 2307.
const f2551 = filing("2551Q", {
  year: "2026",
  quarter: "3rd",
  amended: "no",
  periodType: "calendar",
  taxRelief: "no",
  itRate: "graduated",
  i15: "1000",
  rows: [
    { atc: "PT010", taxable: "150000.00", rate: "3" },
    { atc: "PT120", taxable: "80000.50", rate: "2" },
  ],
});

// 2550Q, Q3 2026: sales, purchases and one Schedule 3 withholding row.
const f2550 = filing("2550Q", {
  year: "2026",
  quarter: "3rd",
  amended: "no",
  periodType: "calendar",
  shortPeriod: "no",
  classification: "Micro",
  i31a: "500000.00",
  i33a: "25000.75",
  i44a: "200000.00",
  i44b: "24000.00",
  i45a: "10000.00",
  i45b: "1200.00",
  sch3: [
    {
      c0: "07/01/2026-09/30/2026",
      c1: "SAMPLE AGENT INC.",
      c2: "100000.00",
      c3: "5000.00",
    },
  ],
});

// 1701Q, Q3 2026: an individual filing on the graduated rates with the itemized
// deduction, and a spouse filing at 8%; a bank payment, a check and a description
// line each; every schedule row carries a figure (whole pesos, as the paper asks).
const f1701Q = filing(
  "1701Q",
  {
    year: "2026",
    amended: "no",
    sheets: "2",
    filerType: "single",
    atc: "II012",
    foreignTaxNo: "FTN-0000123",
    foreignCredit: "yes",
    rateA: "graduated",
    methodA: "itemized",
    spouseTin: "987-654-321",
    spouseRdo: "000",
    spouseType: "comp",
    spouseAtc: "II011",
    spouseName: "SAMPLE, SPOUSE",
    spouseCitizenship: "FILIPINO",
    spouseForeignTaxNo: "FTN-0000456",
    spouseForeignCredit: "no",
    rateB: "eight",
    methodB: "osd",
    salesA: "450000",
    cogsA: "120000",
    deductA: "90000",
    prevTaxableA: "100000",
    nonOpA: "12000",
    nonOpDescA: "INTEREST INCOME",
    gppA: "5000",
    excessA: "1000",
    prevPaidA: "2000",
    cwtPrevA: "3000",
    cwtA: "4000",
    taxPaidPrevA: "500",
    foreignCreditsA: "600",
    otherCreditsA: "700",
    otherCreditsDescA: "OTHER SAMPLE CREDIT",
    surchargeA: "250",
    interestA: "125",
    compromiseA: "1000",
    salesB: "300000",
    nonOpB: "8000",
    nonOp8DescA: "ROYALTIES",
    prev8B: "50000",
    cwtB: "1500",
    p32bank: "SAMPLE BANK",
    p32num: "000123",
    p32date: "9/15/2026",
    p32amt: "12000",
    p33bank: "SAMPLE BNK",
    p33num: "CHK0001",
    p33date: "9/20/2026",
    p33amt: "3000",
    p34num: "TDM0001",
    p34date: "9/25/2026",
    p34amt: "2000",
    p35particular: "OTHER PAYMENT",
    p35bank: "SAMPLE",
    p35num: "OP0001",
    p35date: "9/30/2026",
    p35amt: "1000",
  },
  "2026-Q3",
  TEST_INDIVIDUAL,
);

writeFileSync(
  join(here, "../fixtures/1701Q-sample.xml"),
  build1701Q(f1701Q, TEST_INDIVIDUAL, compute1701Q(f1701Q.data)),
);

// 1701, 2026: an individual with compensation and business income on the graduated
// rates (itemized deductions with a Schedule 4 line, a Schedule 5 line and a NOLCO
// row), a spouse at 8%, penalties, and the Part IX reconciliation lines.
const f1701 = filing(
  "1701",
  {
    year: "2026",
    amended: "no",
    shortPeriod: "no",
    taxpayerType: "biz",
    atc: "II012",
    rateA: "graduated",
    methodA: "itemized",
    foreignCredit: "yes",
    foreignTaxNo: "FTN-0000123",
    civil: "married",
    spouseIncome: "yes",
    filing: "separate",
    incomeExempt: "no",
    incomeSpecial: "no",
    over: "refund",
    attachments: "2",
    lineBus: "SAMPLE TRADING",
    spouseTin: "987-654-321",
    spouseRdo: "000",
    spouseType: "comp",
    spouseAtc: "II011",
    spouseName: "SAMPLE, SPOUSE",
    spouseContact: "09180000000",
    spouseCitizenship: "FILIPINO",
    spouseForeignCredit: "no",
    spouseForeignTaxNo: "",
    spouseIncomeExempt: "no",
    spouseIncomeSpecial: "no",
    spouseRate: "eight",
    spouseMethod: "osd",
    compA: "300000",
    salesA: "1200000",
    returnsA: "20000",
    cogsA: "300000",
    s4_1A: "20000",
    s4_5A: "50000",
    s4_17aA: "8000",
    s5_1amt: "5000",
    nolco4D: "3000",
    otherA: "10000",
    specialRateA: "1000",
    shareGovtA: "200",
    prevPaidA: "15000",
    cwtA: "4000",
    excessA: "1000",
    compCwtA: "12000",
    interestA: "100",
    surchargeA: "250",
    compromiseA: "500",
    ix1A: "400000",
    ix2A: "1000",
    ix2descA: "SAMPLE ADDITION",
    ix6A: "2000",
    ix6descA: "SAMPLE DEDUCTION",
    compB: "250000",
    salesB: "500000",
    otherB: "2000",
    cwtB: "800",
    ix1B: "100000",
  },
  "2026",
  TEST_INDIVIDUAL,
);

writeFileSync(
  join(here, "../fixtures/1701-sample.xml"),
  build1701(f1701, TEST_INDIVIDUAL, compute1701(f1701.data)),
);

// 1702Q, Q3 2026: a company with figures in Schedule 1 (exempt and special at 10%),
// Schedule 2 at 25%, Schedule 3 for two quarters and every Schedule 4 line.
const f1702Q = filing("1702Q", {
  year: "2026",
  quarter: "3rd",
  periodType: "calendar",
  method: "itemized",
  amended: "no",
  attachments: "1",
  atc: "IC010",
  sch1_1A: "100000",
  sch1_2A: "40000",
  sch1_4A: "5000",
  sch1_6A: "10000",
  sch1_8A: "20000",
  sch1Rate: "10",
  sch1_1B: "200000",
  sch1_2B: "80000",
  sch1_4B: "3000",
  sch1_6B: "20000",
  sch1_8B: "15000",
  sch1_12B: "100",
  s2_1: "1500000",
  s2_2: "700000",
  s2_4: "25000",
  s2_6: "300000",
  s2_8: "50000",
  rate: "25",
  sch3_1: "400000",
  sch3_2: "500000",
  sch4_1: "1000",
  sch4_2: "2000",
  sch4_3: "3000",
  sch4_4: "4000",
  sch4_5: "5000",
  sch4_6: "600",
  sch4_6a: "700",
  sch4_6b: "800",
  i15: "500",
  i21: "1000",
  i22: "500",
  i23: "250",
});

writeFileSync(
  join(here, "../fixtures/1702Q-sample.xml"),
  build1702Q(f1702Q, TEST_TAXPAYER, compute1702Q(f1702Q.data)),
);

// The 2551Q and 2550Q fixtures are committed and their proofs pinned; they are
// rewritten only on request (`fixtures --all`): the 2550Q's filing date is the
// day it runs, so a plain run would change them.
if (process.argv.includes("--all")) {
  writeFileSync(
    join(here, "../fixtures/2551Q-sample.xml"),
    build2551Q(f2551, TEST_TAXPAYER, compute2551Q(f2551.data)),
  );
  writeFileSync(
    join(here, "../fixtures/2550Q-sample.xml"),
    build2550Q(f2550, TEST_TAXPAYER, compute2550Q(f2550.data)),
  );
}
console.log("wrote fixtures/*-sample.xml");
