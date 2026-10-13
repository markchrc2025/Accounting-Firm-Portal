// track-c-c6-background.spec.ts — C5/C6 (D55 and its amendment), hermetic: the income-tax
// editors (1701, 1701A, 1701Q). One router answers every /api/v1 call from a table of
// mocks; a call it does not cover fails the test. Invented data only.
//
//   - the card "From the client's record" shows Item 6 (the client's Classification) and,
//     on the 1701 and 1701A, Item 16 (the civil status), with a link to edit the client;
//     a Classification that ticks no box says "Set this client's Classification on the
//     Client page." with a link;
//   - Item 7 (Item 8 on the 1701Q) is a selector listing the ATCs the BIR printed on the
//     form, word for word, starting empty; "Choose Item 7 (ATC)." shows only while it is
//     empty; the choice is saved as d.atc and survives a reload; the word "derived"
//     appears nowhere;
//   - "Spouse has income?" and "Filing status" appear only for a married client, an
//     unanswered one is not saved, and a saved answer for a client who is not married
//     is dropped on the next save.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222c6";
const ME = {
  user: {
    id: "u6000000-0000-4000-8000-0000000000c6",
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
  id: `c6000000-0000-4000-8000-00000000${n}`,
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
  corp: client("0005", {
    kind: "non-individual",
    civilStatus: null,
    classification: "Domestic Corporation",
  }),
};

/** The choices each form prints for the ATC, word for word from the committed template. */
const PRINTED: Record<string, string[]> = {
  "1701": [
    "II012 Business Income-Graduated IT Rates",
    "II014 Income from Profession–Graduated IT Rates",
    "II013 Mixed Income–Graduated IT Rates",
    "II011 Compensation Income",
    "II015 Business Income - 8% IT Rate",
    "II017 Income from Profession – 8% IT Rate",
    "II016 Mixed Income – 8% IT Rate",
  ],
  "1701A": [
    "II012 Business Income - Graduated IT Rates",
    "II014 Income from Profession – Graduated IT Rates",
    "II015 Business Income - 8% IT Rate",
    "II017 Income from Profession – 8% IT Rate",
  ],
  "1701Q": [
    "II012 Business Income-Graduated IT Rates",
    "II014 Income from Profession–Graduated IT Rates",
    "II013 Mixed Income–Graduated IT Rates",
    "II015 Business Income - 8% IT Rate",
    "II017 Income from Profession – 8% IT Rate",
    "II016 Mixed Income – 8% IT Rate",
  ],
  // The 1702Q and 1702RT print one choice, with a blank write-in line beneath it.
  "1702Q": ["IC 055 Minimum Corporate Income Tax (MCIT)"],
  "1702RT": ["IC 055 Minimum Corporate Income Tax (MCIT)"],
};

interface Spec {
  form: "1701" | "1701A" | "1701Q" | "1702Q" | "1702RT";
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
      compA: "300000",
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
  {
    form: "1701Q",
    period: "2026-Q3",
    data: { year: "2026", amended: "no", rateA: "graduated", methodA: "osd" },
    type: "7",
    atc: "8",
  },
];

const idOf = (form: string) =>
  `f6000000-0000-4000-8000-0000000${
    {
      "1701": "1701",
      "1701A": "170a",
      "1701Q": "170q",
      "1702Q": "1702",
      "1702RT": "02rt",
    }[form]
  }`;
const patchRe = (id: string) => new RegExp(`^/api/v1/bir-forms/${id}$`);
const patchBody = (seen: Seen[]) =>
  JSON.parse(seen.find((s) => s.method === "PATCH")!.request.postData() ?? "{}");

for (const spec of SPECS) {
  const ID = idOf(spec.form);
  const hasCivil = spec.form !== "1701Q";
  const choose = `Choose Item ${spec.atc} (ATC).`;
  test.describe(`C6 ${spec.form} editor: Item ${spec.type} from the client, Item ${spec.atc} chosen (hermetic)`, () => {
    test("Single Proprietorship, nothing chosen: the card, the printed choices, an empty selector, the choose line, no 'derived'", async ({
      page,
    }) => {
      const m = await mockApi(page, formOf(spec, ID, CLIENTS.single, spec.data), ID);
      await page.goto(`/bir-forms/${ID}`);
      await expect(
        page.getByText("From the client's record", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("Background · from the client's record")).toHaveCount(
        0,
      );
      await expect(page.getByTestId("bg-type")).toContainText(
        `Item ${spec.type} Taxpayer type`,
      );
      await expect(page.getByTestId("bg-type")).toContainText("Single Proprietorship");
      await expect(page.getByTestId("bg-type")).not.toContainText("Compensation");
      if (hasCivil) await expect(page.getByTestId("bg-civil")).toContainText("Single");
      else await expect(page.getByTestId("bg-civil")).toHaveCount(0);
      await expect(page.getByTestId("bg-married")).toHaveCount(0);
      await expect(page.getByTestId("bg-hint")).toHaveCount(0);
      await expect(page.getByTestId("bg-edit-client")).toHaveAttribute(
        "href",
        `/clients/${CLIENTS.single.id}/edit`,
      );

      const select = page.getByTestId("atc-select");
      await expect(select).toHaveValue("");
      expect(await select.locator("option").allInnerTexts()).toEqual([
        "Not chosen",
        ...PRINTED[spec.form]!,
      ]);
      await expect(
        page.getByText(`Item ${spec.atc} Alphanumeric Tax Code (ATC)`),
      ).toBeVisible();
      await expect(page.getByTestId("atc-choose")).toHaveText(choose);
      await expect(page.getByTestId("bg-atc")).not.toContainText(
        "II012 Business Income-Graduated IT Rates (derived)",
      );
      // The word "derived" is not on the page anywhere.
      await expect(page.locator("body")).not.toContainText(/derived/i);
      expect(m.unmocked).toEqual([]);
    });

    test("choosing an ATC saves it as d.atc, drops the choose line, and survives a reload; clearing it removes it", async ({
      page,
    }) => {
      const code = PRINTED[spec.form]![0]!.split(" ")[0]!;
      let saved: Record<string, unknown> = spec.data;
      const m = await mockApi(page, null, ID, [
        ["GET", patchRe(ID), (r) => json(r, formOf(spec, ID, CLIENTS.single, saved))],
        [
          "PATCH",
          patchRe(ID),
          (r, seen) => {
            saved = (
              JSON.parse(seen.request.postData() ?? "{}") as {
                data: Record<string, unknown>;
              }
            ).data;
            return json(r, formOf(spec, ID, CLIENTS.single, saved));
          },
        ],
      ]);
      await page.goto(`/bir-forms/${ID}`);
      await expect(page.getByTestId("atc-choose")).toBeVisible();
      await page.getByTestId("atc-select").selectOption(code);
      await expect(page.getByTestId("atc-choose")).toHaveCount(0);
      await page.getByRole("button", { name: /Save changes/ }).click();
      await expect.poll(() => m.seen.filter((s) => s.method === "PATCH").length).toBe(1);
      const body = patchBody(m.seen);
      expect(body.data.atc).toBe(code);
      expect(body.data.taxpayerType).toBeUndefined();
      expect(body.data.filerType).toBeUndefined();

      await page.reload();
      await expect(page.getByTestId("atc-select")).toHaveValue(code);
      await expect(page.getByTestId("atc-choose")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(/derived/i);

      await page.getByTestId("atc-select").selectOption("");
      await expect(page.getByTestId("atc-choose")).toHaveText(choose);
      await page.getByRole("button", { name: /Save changes/ }).click();
      await expect.poll(() => m.seen.filter((s) => s.method === "PATCH").length).toBe(2);
      const second = JSON.parse(
        m.seen.filter((s) => s.method === "PATCH")[1]!.request.postData() ?? "{}",
      );
      expect(second.data.atc).toBeUndefined();
      expect(m.unmocked).toEqual([]);
    });

    test("a saved ATC the form does not print is shown, named, so it can be changed", async ({
      page,
    }) => {
      const data = { ...spec.data, atc: "II099" };
      const m = await mockApi(page, formOf(spec, ID, CLIENTS.single, data), ID);
      await page.goto(`/bir-forms/${ID}`);
      await expect(page.getByTestId("atc-select")).toHaveValue("II099");
      await expect(page.getByTestId("atc-select")).toContainText(
        `II099 — not printed on BIR Form ${spec.form}`,
      );
      expect(m.unmocked).toEqual([]);
    });

    test("a Classification that ticks no Item 6 box: the card says what to set, with a link to the client", async ({
      page,
    }) => {
      for (const [c, shown] of [
        [CLIENTS.noClass, "Not set"],
        [CLIENTS.corp, "Domestic Corporation"],
      ] as const) {
        const m = await mockApi(page, formOf(spec, ID, c, spec.data), ID);
        await page.goto(`/bir-forms/${ID}`);
        await expect(page.getByTestId("bg-type")).toContainText(shown);
        await expect(page.getByTestId("bg-hint")).toHaveText(
          "Set this client's Classification on the Client page.",
        );
        await expect(page.getByTestId("bg-hint").getByRole("link")).toHaveAttribute(
          "href",
          `/clients/${c.id}/edit`,
        );
        expect(m.unmocked).toEqual([]);
        await page.unrouteAll({ behavior: "ignoreErrors" });
      }
    });

    if (hasCivil) {
      test("a married client: the two spouse questions appear, start blank, and save only when answered", async ({
        page,
      }) => {
        const m = await mockApi(page, formOf(spec, ID, CLIENTS.married, spec.data), ID, [
          [
            "PATCH",
            patchRe(ID),
            (r) => json(r, formOf(spec, ID, CLIENTS.married, spec.data)),
          ],
        ]);
        await page.goto(`/bir-forms/${ID}`);
        await expect(page.getByTestId("bg-type")).toContainText("Professional");
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
        await expect
          .poll(() => m.seen.filter((s) => s.method === "PATCH").length)
          .toBe(1);
        const body = patchBody(m.seen);
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
            patchRe(ID),
            (r) => json(r, formOf(spec, ID, CLIENTS.married, spec.data)),
          ],
        ]);
        await page.goto(`/bir-forms/${ID}`);
        await expect(page.getByTestId("bg-married")).toBeVisible();
        await page.getByRole("button", { name: /Save changes/ }).click();
        await expect
          .poll(() => m.seen.filter((s) => s.method === "PATCH").length)
          .toBe(1);
        const body = patchBody(m.seen);
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
            patchRe(ID),
            (r) => json(r, formOf(spec, ID, CLIENTS.widow, spec.data)),
          ],
        ]);
        await page.goto(`/bir-forms/${ID}`);
        await expect(page.getByTestId("bg-civil")).toContainText("Widow/er");
        await expect(page.getByTestId("bg-married")).toHaveCount(0);
        await page.getByRole("button", { name: /Save changes/ }).click();
        await expect
          .poll(() => m.seen.filter((s) => s.method === "PATCH").length)
          .toBe(1);
        const body = patchBody(m.seen);
        expect(body.data.spouseIncome).toBeUndefined();
        expect(body.data.filing).toBeUndefined();
      });
    } else {
      test("a married professional: no civil status row and no spouse controls on the 1701Q", async ({
        page,
      }) => {
        const m = await mockApi(page, formOf(spec, ID, CLIENTS.married, spec.data), ID);
        await page.goto(`/bir-forms/${ID}`);
        await expect(page.getByTestId("bg-type")).toContainText("Professional");
        await expect(page.getByTestId("bg-civil")).toHaveCount(0);
        await expect(page.getByTestId("bg-married")).toHaveCount(0);
        expect(m.unmocked).toEqual([]);
      });
    }
  });
}

test.describe("C6 1701 editor: compensation figures do not change Item 6", () => {
  const ID = "f6000000-0000-4000-8000-00000001701c";
  const spec: Spec = { form: "1701", period: "2026", data: {}, type: "6", atc: "7" };
  test("a Single Proprietorship client with compensation figures only still shows Single Proprietorship, and adding business figures changes nothing", async ({
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
    await expect(page.getByTestId("bg-type")).toContainText("Single Proprietorship");
    await expect(page.getByTestId("bg-type")).not.toContainText("Compensation");
    await expect(page.getByTestId("atc-select")).toHaveValue("");
    await page
      .getByLabel(/Net sales|Sales/i)
      .first()
      .fill("450000");
    await expect(page.getByTestId("bg-type")).toContainText("Single Proprietorship");
    await expect(page.getByTestId("atc-select")).toHaveValue("");
    await expect(page.getByTestId("atc-choose")).toBeVisible();
  });
});

// The 1702Q and 1702RT: the same selector, no background card of their own.
const SPECS_1702: Spec[] = [
  {
    form: "1702Q",
    period: "2026-Q3",
    data: { year: "2026", amended: "no", rate: "25", method: "itemized" },
    type: "",
    atc: "5",
  },
  {
    form: "1702RT",
    period: "2026",
    data: { year: "2026", amended: "no", rate: "25", method: "itemized" },
    type: "",
    atc: "5",
  },
];

for (const spec of SPECS_1702) {
  const ID = idOf(spec.form);
  test.describe(`C6 ${spec.form} editor: the ATC (Item 5) is chosen, never defaulted (hermetic)`, () => {
    test("nothing chosen: the printed choice, an empty selector, 'Choose the ATC.', no 'derived', no background card", async ({
      page,
    }) => {
      const m = await mockApi(page, formOf(spec, ID, CLIENTS.corp, spec.data), ID);
      await page.goto(`/bir-forms/${ID}`);
      const select = page.getByTestId("atc-select");
      await expect(select).toHaveValue("");
      expect(await select.locator("option").allInnerTexts()).toEqual([
        "Not chosen",
        ...PRINTED[spec.form]!,
      ]);
      await expect(page.getByText("Item 5 Alphanumeric Tax Code (ATC)")).toBeVisible();
      await expect(page.getByTestId("atc-choose")).toHaveText("Choose the ATC.");
      await expect(page.getByText("From the client's record")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(/derived/i);
      expect(m.unmocked).toEqual([]);
    });

    test("choosing IC 055 saves d.atc and survives a reload; clearing removes it; no IC010 anywhere", async ({
      page,
    }) => {
      let saved: Record<string, unknown> = spec.data;
      const m = await mockApi(page, null, ID, [
        ["GET", patchRe(ID), (r) => json(r, formOf(spec, ID, CLIENTS.corp, saved))],
        [
          "PATCH",
          patchRe(ID),
          (r, seen) => {
            saved = (
              JSON.parse(seen.request.postData() ?? "{}") as {
                data: Record<string, unknown>;
              }
            ).data;
            return json(r, formOf(spec, ID, CLIENTS.corp, saved));
          },
        ],
      ]);
      await page.goto(`/bir-forms/${ID}`);
      await expect(page.locator("body")).not.toContainText("IC010");
      await page.getByTestId("atc-select").selectOption("IC055");
      await expect(page.getByTestId("atc-choose")).toHaveCount(0);
      await page.getByRole("button", { name: /Save changes/ }).click();
      await expect.poll(() => m.seen.filter((s) => s.method === "PATCH").length).toBe(1);
      expect(patchBody(m.seen).data.atc).toBe("IC055");

      await page.reload();
      await expect(page.getByTestId("atc-select")).toHaveValue("IC055");
      await expect(page.getByTestId("atc-choose")).toHaveCount(0);

      await page.getByTestId("atc-select").selectOption("");
      await expect(page.getByTestId("atc-choose")).toHaveText("Choose the ATC.");
      await page.getByRole("button", { name: /Save changes/ }).click();
      await expect.poll(() => m.seen.filter((s) => s.method === "PATCH").length).toBe(2);
      const second = JSON.parse(
        m.seen.filter((s) => s.method === "PATCH")[1]!.request.postData() ?? "{}",
      );
      expect(second.data.atc).toBeUndefined();
      expect(m.unmocked).toEqual([]);
    });

    test("a draft saved with an ATC the form does not print (IC010) shows it, named, so it can be changed", async ({
      page,
    }) => {
      const data = { ...spec.data, atc: "IC010" };
      const m = await mockApi(page, formOf(spec, ID, CLIENTS.corp, data), ID);
      await page.goto(`/bir-forms/${ID}`);
      await expect(page.getByTestId("atc-select")).toHaveValue("IC010");
      await expect(page.getByTestId("atc-select")).toContainText(
        `IC010 — not printed on BIR Form ${spec.form}`,
      );
      expect(m.unmocked).toEqual([]);
    });
  });
}
