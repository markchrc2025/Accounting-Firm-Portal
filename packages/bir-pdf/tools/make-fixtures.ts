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
  build2550Q,
  build2551Q,
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

function filing(form: Filing["form"], data: Filing["data"]): Filing {
  return {
    id: `fixture-${form}`,
    form,
    taxpayerId: TEST_TAXPAYER.id,
    status: "filed",
    period: "2026-Q3",
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

writeFileSync(
  join(here, "../fixtures/2551Q-sample.xml"),
  build2551Q(f2551, TEST_TAXPAYER, compute2551Q(f2551.data)),
);
writeFileSync(
  join(here, "../fixtures/2550Q-sample.xml"),
  build2550Q(f2550, TEST_TAXPAYER, compute2550Q(f2550.data)),
);
console.log("wrote fixtures/2551Q-sample.xml and fixtures/2550Q-sample.xml");
