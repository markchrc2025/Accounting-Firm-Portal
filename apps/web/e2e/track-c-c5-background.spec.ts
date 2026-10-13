// track-c-c5-background.spec.ts — C5 (D55), hermetic: the income-tax editors show the
// return's background from the client's record. One router answers every /api/v1 call
// from a table of mocks; a call it does not cover fails the test. Invented data only.
//
//   - Item 6 (taxpayer type) and Item 7 (ATC) are shown read-only, derived;
//   - Item 16 is the client's civil status;
//   - "Spouse has income?" and "Filing status" appear only for a married client, an
//     unanswered one is not saved, and a saved answer for a client who is not married
//     is dropped on the next save;
//   - the 1701Q shows Items 7 and 8 and no spouse controls.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222c5";
const ME = {
  user: {
    id: "u5000000-0000-4000-8000-0000000000c5",
    email: "operator@example.test",
    fullName: "Test Operator",
    userType: "FIRM",
    firmId: FIRM_ID,
    mfaEnabled: true,
  },
  permissions: {
    global: [
      "BIRForms:Read",
      "BIRForms:Create",
      "BIRForms:Update",
      "BIRForms:File",
      "Clients:Read",
    ],
    clients: [],
    assignedClientIds: [],
    canViewAllClients: true,
  },
};

interface Seen {
  method: string;
  path: string;
  request: Request;
}
type Handler = (route: Route, seen: Seen) => Promise<void> | void;
type Entry = [method: string, pattern: RegExp, handler: Handler];
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const client = (n: string, over: Record<string, unknown>) => ({
  id: `c5000000-0000-4000-8000-00000000${n}`,
  businessName: `INVENTED CLIENT ${n}`,
  kind: "individual",
  tin: "000-555-777-00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
  ...over,
});
const CLIENTS = {
  single: client("0001", {
    civilStatus: "Single",
    classification: "Single Proprietorship",
  }),
  married: client("0002", { civilStatus: "Married", classification: "Professional" }),
  widow: client("0003", {
    civilStatus: "Widow/Widower",
    classification: "Single Proprietorship",
  }),
  noClass: client("0004", { civilStatus: "Single", classification: null }),
};

interface Spec {
  form: "1701" | "1701A" | "1701Q";
  period: string;
  /** The draft's data a freshly saved editor would hold. */
  data: Record<string, unknown>;
  type: string;
  atc: string;
}

function formOf(
  spec: Spec,
  id: string,
  c: (typeof CLIENTS)[keyof typeof CLIENTS],
  data: Record<string, unknown>,
) {
  return {
    id,
    clientId: c.id,
    clientName: c.businessName,
    form: spec.form,
    status: "draft",
    period: spec.period,
    filedAt: null,
    createdAt: "2026-10-01T01:00:00.000Z",
    updatedAt: "2026-10-09T02:00:00.000Z",
    amendsId: null,
    sequence: 1,
    data,
    computed: null,
    exports: [],
    filedSnapshot: null,
    clearCopyAvailable: false,
    previewAvailable: true,
    canDelete: true,
  };
}

async function mockApi(page: Page, formBody: unknown, id: string, extra: Entry[] = []) {
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("portal_token", "test-token-not-a-secret");
  });
  const base: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, ME)],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    ["GET", /^\/api\/v1\/profile\/me$/, (r) => json(r, { ...ME.user, avatarUrl: null })],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, Object.values(CLIENTS))],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r) => json(r, CLIENTS.single)],
    ["GET", /^\/api\/v1\/clients\/[^/]+\/.+$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir\/atc-codes$/, (r) => json(r, [])],
    ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, {})],
    ["GET", new RegExp(`^/api/v1/bir-forms/${id}$`), (r) => json(r, formBody)],
  ];
  const table = [...base, ...extra];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const e: Seen = { method: req.method(), path: url.pathname, request: req };
    seen.push(e);
    for (let i = table.length - 1; i >= 0; i--) {
      const [m, re, h] = table[i]!;
      if (m === e.method && re.test(e.path)) return h(route, e);
    }
    unmocked.push(`${e.method} ${e.path}${url.search}`);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  return { seen, unmocked };
}

const SPECS: Spec[] = [
  {
    form: "1701",
    period: "2026",
    data: {
      year: "2026",
      amended: "no",
      rateA: "graduated",
      methodA: "osd",
      salesA: "450000",
    },
    type: "6",
    atc: "7",
  },
  {
    form: "1701A",
    period: "2026",
    data: { year: "2026", taxRate: "graduated", amended: "no" },
    type: "6",
    atc: "7",
  },
];

for (const spec of SPECS) {
  const ID = `f5000000-0000-4000-8000-0000000${spec.form === "1701" ? "1701" : "170a"}`;
  test.describe(`C5 ${spec.form} editor: background from the client's record (hermetic)`, () => {
    test("a single proprietor: Item 6 and the derived ATC are shown, civil status Single, no spouse controls", async ({
      page,
    }) => {
      const m = await mockApi(page, formOf(spec, ID, CLIENTS.single, spec.data), ID);
      await page.goto(`/bir-forms/${ID}`);
      await expect(page.getByTestId("bg-type")).toContainText("Single Proprietor");
      await expect(page.getByTestId("bg-atc")).toContainText("II012");
      await expect(page.getByTestId("bg-civil")).toContainText("Single");
      await expect(page.getByTestId("bg-married")).toHaveCount(0);
      await expect(page.getByTestId("bg-hint")).toHaveCount(0);
      expect(m.unmocked).toEqual([]);
    });

    test("a married professional at 8%: the ATC follows the rate; the two spouse questions appear, start blank, and save only when answered", async ({
      page,
    }) => {
      const data = {
        ...spec.data,
        ...(spec.form === "1701A" ? { taxRate: "eight" } : { rateA: "eight" }),
      };
      const m = await mockApi(page, formOf(spec, ID, CLIENTS.married, data), ID, [
        [
          "PATCH",
          new RegExp(`^/api/v1/bir-forms/${ID}$`),
          (r) => json(r, formOf(spec, ID, CLIENTS.married, data)),
        ],
      ]);
      await page.goto(`/bir-forms/${ID}`);
      await expect(page.getByTestId("bg-type")).toContainText("Professional");
      await expect(page.getByTestId("bg-atc")).toContainText("II017");
      await expect(page.getByTestId("bg-civil")).toContainText("Married");
      const married = page.getByTestId("bg-married");
      await expect(married).toBeVisible();
      const [income, filing] = [
        married.locator("select").nth(0),
        married.locator("select").nth(1),
      ];
      await expect(income).toHaveValue("");
      await expect(filing).toHaveValue("");

      await income.selectOption("yes");
      await filing.selectOption("joint");
      await page.getByRole("button", { name: /Save changes/ }).click();
      await expect.poll(() => m.seen.filter((s) => s.method === "PATCH").length).toBe(1);
      const body = JSON.parse(
        m.seen.find((s) => s.method === "PATCH")!.request.postData() ?? "{}",
      );
      expect(body.data).toMatchObject({ spouseIncome: "yes", filing: "joint" });
      expect(body.data.taxpayerType).toBeUndefined();
      expect(body.data.atc).toBeUndefined();
      expect(m.unmocked).toEqual([]);
    });

    test("a married client with nothing answered saves neither answer", async ({
      page,
    }) => {
      const m = await mockApi(page, formOf(spec, ID, CLIENTS.married, spec.data), ID, [
        [
          "PATCH",
          new RegExp(`^/api/v1/bir-forms/${ID}$`),
          (r) => json(r, formOf(spec, ID, CLIENTS.married, spec.data)),
        ],
      ]);
      await page.goto(`/bir-forms/${ID}`);
      await expect(page.getByTestId("bg-married")).toBeVisible();
      await page.getByRole("button", { name: /Save changes/ }).click();
      await expect.poll(() => m.seen.filter((s) => s.method === "PATCH").length).toBe(1);
      const body = JSON.parse(
        m.seen.find((s) => s.method === "PATCH")!.request.postData() ?? "{}",
      );
      expect(body.data.spouseIncome).toBeUndefined();
      expect(body.data.filing).toBeUndefined();
    });

    test("a widow(er) with stale spouse answers in the draft: no spouse controls, and the answers are dropped on save", async ({
      page,
    }) => {
      const data = { ...spec.data, spouseIncome: "yes", filing: "joint" };
      const m = await mockApi(page, formOf(spec, ID, CLIENTS.widow, data), ID, [
        [
          "PATCH",
          new RegExp(`^/api/v1/bir-forms/${ID}$`),
          (r) => json(r, formOf(spec, ID, CLIENTS.widow, spec.data)),
        ],
      ]);
      await page.goto(`/bir-forms/${ID}`);
      await expect(page.getByTestId("bg-civil")).toContainText("Widow/er");
      await expect(page.getByTestId("bg-married")).toHaveCount(0);
      await page.getByRole("button", { name: /Save changes/ }).click();
      await expect.poll(() => m.seen.filter((s) => s.method === "PATCH").length).toBe(1);
      const body = JSON.parse(
        m.seen.find((s) => s.method === "PATCH")!.request.postData() ?? "{}",
      );
      expect(body.data.spouseIncome).toBeUndefined();
      expect(body.data.filing).toBeUndefined();
    });

    test("a client with no classification: nothing is derived, and the card says what to set", async ({
      page,
    }) => {
      const m = await mockApi(page, formOf(spec, ID, CLIENTS.noClass, spec.data), ID);
      await page.goto(`/bir-forms/${ID}`);
      await expect(page.getByTestId("bg-type")).toContainText("—");
      await expect(page.getByTestId("bg-atc")).toContainText("—");
      await expect(page.getByTestId("bg-hint")).toContainText(
        "set the client's classification",
      );
      expect(m.unmocked).toEqual([]);
    });
  });
}

test.describe("C5 1701 editor: compensation and business income", () => {
  const ID = "f5000000-0000-4000-8000-00000001701c";
  const spec: Spec = { form: "1701", period: "2026", data: {}, type: "6", atc: "7" };
  test("compensation only is a Compensation Earner (II011); adding business income makes it mixed (II013)", async ({
    page,
  }) => {
    const data = {
      year: "2026",
      amended: "no",
      rateA: "graduated",
      methodA: "osd",
      compA: "300000",
    };
    await mockApi(page, formOf(spec, ID, CLIENTS.single, data), ID);
    await page.goto(`/bir-forms/${ID}`);
    await expect(page.getByTestId("bg-type")).toContainText("Compensation Earner");
    await expect(page.getByTestId("bg-atc")).toContainText("II011");
    await page
      .getByLabel(/Net sales|Sales/i)
      .first()
      .fill("450000");
    await expect(page.getByTestId("bg-atc")).toContainText("II013");
    await expect(page.getByTestId("bg-type")).toContainText("Single Proprietor");
  });
});

test.describe("C5 1701Q editor: Items 7 and 8", () => {
  const ID = "f5000000-0000-4000-8000-00000001701q";
  const spec: Spec = {
    form: "1701Q",
    period: "2026-Q3",
    data: { year: "2026", amended: "no", rateA: "eight", methodA: "osd" },
    type: "7",
    atc: "8",
  };
  test("a professional at 8%: Item 7 Professional, Item 8 II017; no civil or spouse controls", async ({
    page,
  }) => {
    const m = await mockApi(page, formOf(spec, ID, CLIENTS.married, spec.data), ID);
    await page.goto(`/bir-forms/${ID}`);
    await expect(page.getByTestId("bg-type")).toContainText("Professional");
    await expect(page.getByTestId("bg-atc")).toContainText("II017");
    await expect(page.getByTestId("bg-civil")).toHaveCount(0);
    await expect(page.getByTestId("bg-married")).toHaveCount(0);
    expect(m.unmocked).toEqual([]);
  });
});
