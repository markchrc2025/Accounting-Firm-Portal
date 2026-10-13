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
  build1701A,
  build1701Q,
  build1702Q,
  build1702RT,
  build2550Q,
  build2551Q,
  compute1701,
  compute1701A,
  compute1701Q,
  compute1702Q,
  compute1702RT,
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
  civilStatus: "Married",
  taxpayerType: "",
  classification: "Single Proprietorship",
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

// 1701, 2026: a married individual (the client's civil status) with compensation and
// business income on the graduated rates (itemized deductions with a Schedule 4 line,
// a Schedule 5 line and a NOLCO row), a spouse at 8%, penalties and the Part IX
// reconciliation lines. Every figure is distinct so the label test (C5 T2) can tell
// which one printed where.
const f1701 = filing(
  "1701",
  {
    year: "2026",
    amended: "no",
    shortPeriod: "no",
    rateA: "graduated",
    methodA: "itemized",
    rateB: "eight",
    methodB: "osd",
    foreignCredit: "yes",
    foreignTaxNo: "FTN-0000123",
    spouseIncome: "yes",
    filing: "separate",
    incomeExempt: "no",
    incomeSpecial: "no",
    over: "refund",
    attachments: "2",
    lineBus: "SAMPLE TRADING",
    spouseTin: "987-654-321",
    spouseRdo: "000",
    spouseName: "SAMPLE, SPOUSE",
    spouseContact: "09180000000",
    spouseCitizenship: "FILIPINO",
    spouseForeignCredit: "no",
    spouseForeignTaxNo: "",
    spouseIncomeExempt: "no",
    spouseIncomeSpecial: "no",
    compA: "311111",
    salesA: "1234000",
    returnsA: "24000",
    cogsA: "376000",
    s4_1A: "21000",
    s4_5A: "52000",
    s4_17aA: "8300",
    s5_1amt: "5500",
    nolco4D: "3700",
    otherA: "12300",
    specialRateA: "1100",
    shareGovtA: "220",
    prevPaidA: "15500",
    cwtA: "4400",
    excessA: "1300",
    compCwtA: "12600",
    interestA: "130",
    surchargeA: "260",
    compromiseA: "510",
    ix1A: "400000",
    ix2A: "1000",
    ix2descA: "SAMPLE ADDITION",
    ix6A: "2000",
    ix6descA: "SAMPLE DEDUCTION",
    compB: "255111",
    salesB: "502000",
    otherB: "2100",
    prevPaidB: "6200",
    cwtB: "810",
    compCwtB: "9900",
    ix1B: "100000",
  },
  "2026",
  TEST_INDIVIDUAL,
);

writeFileSync(
  join(here, "../fixtures/1701-sample.xml"),
  build1701(f1701, TEST_INDIVIDUAL, compute1701(f1701.data)),
);

// 1701A, 2026: purely business income on the graduated rates with OSD, a spouse at
// 8%, every Part IV line filled on the filer's side, one line of each description.
const f1701A = filing(
  "1701A",
  {
    year: "2026",
    amended: "no",
    shortPeriod: "no",
    taxpayerType: "single",
    atc: "II012",
    taxRate: "graduated",
    foreignCredit: "yes",
    foreignTaxNo: "FTN-0000123",
    civil: "married",
    spouseIncome: "yes",
    filing: "separate",
    over: "tcc",
    attachments: "3",
    spouseTin: "987-654-321",
    spouseRdo: "000",
    spouseType: "prof",
    spouseAtc: "II017",
    spouseName: "SAMPLE, SPOUSE",
    spouseContact: "09180000000",
    spouseCitizenship: "FILIPINO",
    spouseForeignCredit: "no",
    spouseForeignTaxNo: "",
    spouseTaxRate: "eight",
    i36A: "900000",
    i37A: "15000",
    i41A: "5000",
    i41label: "INTEREST INCOME",
    i42A: "2000",
    i42label: "ROYALTIES",
    i43A: "1000",
    i57A: "1000",
    i58A: "12000",
    i59A: "3000",
    i60A: "4000",
    i61A: "500",
    i62A: "600",
    i63A: "700",
    i63label: "OTHER SAMPLE CREDIT",
    i23A: "0",
    i25A: "250",
    i26A: "125",
    i27A: "1000",
    i47B: "400000",
    i48B: "10000",
    i50B: "1500",
    i50label: "SAMPLE INCOME",
    i51B: "500",
    i57B: "100",
    p32bank: "SAMPLE BANK",
    p32num: "000123",
    p32date: "9/15/2026",
    p32amt: "12000",
    p35particular: "OTHER PAYMENT",
    p35bank: "SAMPLE",
    p35num: "OP0001",
    p35date: "9/30/2026",
    p35amt: "1000",
  },
  "2026",
  TEST_INDIVIDUAL,
);

writeFileSync(
  join(here, "../fixtures/1701A-sample.xml"),
  build1701A(f1701A, TEST_INDIVIDUAL, compute1701A(f1701A.data)),
);

// 1702-RT, 2026: a company on the regular 25% rate with itemized deductions (a
// Schedule I line, a Schedule II line, a NOLCO row and an excess-MCIT row), tax
// credits with both "other" lines described, penalties, a payment by check and the
// Schedule V reconciliation lines. TEST_TAXPAYER with an invented incorporation date.
const f1702RT = filing(
  "1702RT",
  {
    year: "2026",
    periodType: "calendar",
    method: "itemized",
    amended: "no",
    shortPeriod: "no",
    atc: "IC010",
    over: "carry",
    attachments: "2",
    treasurer: "SAMPLE TREASURER",
    presTitle: "PRESIDENT",
    presTin: "111-222-333",
    treasTitle: "TREASURER",
    treasTin: "444-555-666",
    pay24bank: "SAMPLE",
    pay24num: "CHK0001",
    pay24date: "10/01/2026",
    pay24amt: "5000",
    i27: "5000000",
    i28: "100000",
    i30: "2000000",
    i32: "50000",
    rate: "25",
    s1_1: "20000",
    s1_5: "50000",
    s1_17a: "8000",
    s1_17d: "3000",
    s1_17ddesc: "SAMPLE EXPENSE",
    s2_1amt: "5000",
    s2_1desc: "SAMPLE SPECIAL",
    s2_1legal: "SEC 34",
    nolco4Year: "2023",
    nolco4A: "100000",
    nolco4B: "10000",
    nolco4C: "5000",
    nolco4D: "20000",
    mcit1Year: "2024",
    mcit1A: "90000",
    mcit1B: "100000",
    mcit1C: "10000",
    mcit1D: "1000",
    mcit1E: "500",
    mcit1F: "2000",
    i44: "1000",
    i45: "2000",
    i46: "3000",
    i48: "4000",
    i49: "5000",
    i50: "600",
    i51: "700",
    i52: "800",
    i53: "900",
    i53desc: "OTHER CREDIT ONE",
    i54: "1000",
    i54desc: "OTHER CREDIT TWO",
    i17: "1000",
    i18: "500",
    i19: "250",
    schV1: "3000000",
    schV2: "1000",
    schV2desc: "SAMPLE ADDITION",
    schV5: "2000",
    schV5desc: "SAMPLE DEDUCTION",
  },
  "2026",
  { ...TEST_TAXPAYER, incorpDate: "2010-03-09" },
);

writeFileSync(
  join(here, "../fixtures/1702RT-sample.xml"),
  build1702RT(
    f1702RT,
    { ...TEST_TAXPAYER, incorpDate: "2010-03-09" },
    compute1702RT(f1702RT.data),
  ),
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
