/**
 * track-a-tax-estimate.db-spec.ts — U10 against the real Nest app over HTTP and the
 * local PostgreSQL. GET /clients/:clientId/tax-estimate computes the management
 * estimate once, for a year or a quarter, from posted records and the client's own
 * Tax Rule (R1–R4, D47). Every firm, client, figure and user is invented.
 *
 * Every expected figure is worked by hand in a comment beside it. The graduated
 * schedule is TRAIN Table 2 (2023 onwards): over 250,000 → 15%; over 400,000 →
 * 22,500 + 20%; over 800,000 → 102,500 + 25%; … — the same table today's Tax
 * Estimate page hard-codes.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { authenticator } from "otplib";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { DEFAULT_ROLES } from "../../src/rbac/permissions.constants";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-tax-estimate-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const SIMPLIFIED8_ASSUMPTION =
  "assumes no compensation income; a mixed-income earner gets no ₱250,000 reduction.";

describe("U10 · the tax estimate is computed once, for a period, from the client's rule (real app over HTTP, db)", () => {
  let app: INestApplication;
  let writer: PrismaService;
  let tokens: TokenService;
  let firmId = "";
  let saToken = "";
  const ids: Record<string, string> = {};
  const cats: Record<string, { income: string; expense: string }> = {};

  const http = () => request(app.getHttpServer());
  const estimate = (clientId: string, query: string, token = saToken) =>
    http()
      .get(`${API}/clients/${clientId}/tax-estimate${query}`)
      .set("Authorization", `Bearer ${token}`);

  async function client(key: string, taxType: "VAT" | "PERCENTAGE" | null) {
    const c = await writer.client.create({
      data: {
        firmId,
        businessName: `${TAG} ${key}`,
        tin: `000000${String(Object.keys(ids).length + 701).padStart(3, "0")}`,
        taxType,
      },
    });
    ids[key] = c.id;
    const income = await writer.category.create({
      data: { clientId: c.id, type: "INCOME", name: `${TAG} sales` },
    });
    const expense = await writer.category.create({
      data: { clientId: c.id, type: "EXPENSE", name: `${TAG} costs` },
    });
    cats[key] = { income: income.id, expense: expense.id };
    return c.id;
  }

  const sale = (
    key: string,
    date: string,
    net: number,
    vatClass: string,
    outputVAT = 0,
  ) =>
    writer.incomeTransaction.create({
      data: {
        clientId: ids[key]!,
        categoryId: cats[key]!.income,
        txnDate: new Date(`${date}T00:00:00.000Z`),
        description: `${TAG} sale`,
        netAmount: net,
        vatClass,
        outputVAT,
      },
    });

  const cost = (
    key: string,
    date: string,
    net: number,
    opts: { deductible?: boolean; inputVAT?: number; status?: "posted" | "held" } = {},
  ) =>
    writer.purchaseTransaction.create({
      data: {
        clientId: ids[key]!,
        categoryId: cats[key]!.expense,
        txnDate: new Date(`${date}T00:00:00.000Z`),
        description: `${TAG} cost`,
        netAmount: net,
        deductible: opts.deductible ?? true,
        inputVAT: opts.inputVAT ?? 0,
        status: opts.status ?? "posted",
      },
    });

  const rule = (key: string, method: string, flatRate: number | null) =>
    writer.taxRule.create({
      data: { clientId: ids[key]!, method, flatRate, bracketsJson: [] },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    writer = app.get(PrismaService);
    tokens = app.get(TokenService);
    firmId = (await writer.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } }))
      .id;
    const sa = await writer.user.create({
      data: {
        firmId,
        userType: "FIRM",
        fullName: `${TAG} super admin`,
        email: `${TAG}-sa@example.com`,
        status: "ACTIVE",
        firmProfile: { create: { title: "Test" } },
        userRoles: {
          create: {
            roleId: (
              await writer.role.findUniqueOrThrow({
                where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
              })
            ).id,
          },
        },
      },
    });
    saToken = tokens.signAccess({ id: sa.id, firmId, userType: "FIRM", email: sa.email });

    // Alpha — percentage-tax client on the default (graduated, TRAIN) rule, 2026 only.
    await client("alpha", "PERCENTAGE");
    await sale("alpha", "2026-02-10", 300000, "NON_VAT");
    await sale("alpha", "2026-08-15", 500000, "NON_VAT");
    await sale("alpha", "2026-10-05", 200000, "NON_VAT");
    await cost("alpha", "2026-03-05", 100000);
    await cost("alpha", "2026-05-01", 20000, { deductible: false });
    await cost("alpha", "2026-07-20", 50000);
    await cost("alpha", "2026-10-03", 30000);

    // Bravo — percentage-tax client on the 8% option.
    await client("bravo", "PERCENTAGE");
    await rule("bravo", "simplified8", 8);
    await sale("bravo", "2026-04-01", 1000000, "NON_VAT");
    await cost("bravo", "2026-04-02", 100000);

    // Charlie — exempt from business tax (taxType null, D39), default rule.
    await client("charlie", null);
    await sale("charlie", "2026-05-01", 400000, "EXEMPT");

    // Delta — VAT-registered, default rule.
    await client("delta", "VAT");
    await sale("delta", "2026-06-01", 500000, "VATABLE_12", 60000);
    await cost("delta", "2026-06-02", 200000, { inputVAT: 24000 });

    // Echo — flat 25%; Foxtrot — the "percentage" method at 1%.
    await client("echo", "PERCENTAGE");
    await rule("echo", "flat", 25);
    await sale("echo", "2026-03-01", 600000, "NON_VAT");
    await cost("echo", "2026-03-02", 100000);
    await client("foxtrot", "PERCENTAGE");
    await rule("foxtrot", "percentage", 1);
    await sale("foxtrot", "2026-03-01", 600000, "NON_VAT");
    await cost("foxtrot", "2026-03-02", 100000);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("T1 · graduated (the default rule), by period", () => {
    it("year=2026 with records only in 2026 gives exactly what today's page formula gives", async () => {
      const res = await estimate(ids.alpha!, "?year=2026");
      expect(res.status).toBe(200);
      // Page formula: gross = Σ income net = 300,000 + 500,000 + 200,000 = 1,000,000.
      // Deductible = Σ deductible posted costs = 100,000 + 50,000 + 30,000 = 180,000
      // (the 20,000 non-deductible cost is left out). Taxable = 820,000.
      // TRAIN: 820,000 is over 800,000 → 102,500 + (820,000 − 800,000) × 25% = 107,500.
      // Percentage tax: 3% × 1,000,000 = 30,000.
      expect(res.body.basis).toBe("management-estimate");
      expect(res.body.period).toMatchObject({ year: 2026, quarter: null });
      expect(res.body.method).toMatchObject({ name: "graduated", source: "default" });
      expect(res.body.incomeTax).toMatchObject({
        grossIncome: 1000000,
        deductibleExpenses: 180000,
        taxableIncome: 820000,
        due: 107500,
      });
      expect(res.body.businessTax).toMatchObject({
        kind: "percentage",
        grossReceipts: 1000000,
        rate: 3,
        due: 30000,
      });
      expect(res.body.assumptions.length).toBeGreaterThan(0);
    });

    it("quarter=3: income tax January to September, business tax July to September only", async () => {
      const res = await estimate(ids.alpha!, "?year=2026&quarter=3");
      expect(res.status).toBe(200);
      expect(res.body.period).toMatchObject({
        year: 2026,
        quarter: 3,
        incomeTaxFrom: "2026-01-01",
        incomeTaxTo: "2026-09-30",
        businessTaxFrom: "2026-07-01",
        businessTaxTo: "2026-09-30",
      });
      // Income tax, 1 Jan – 30 Sep: gross 300,000 + 500,000 = 800,000; deductible
      // 100,000 + 50,000 = 150,000; taxable 650,000 → 22,500 + 250,000 × 20% = 72,500.
      expect(res.body.incomeTax).toMatchObject({
        grossIncome: 800000,
        deductibleExpenses: 150000,
        taxableIncome: 650000,
        due: 72500,
      });
      // Business tax, 1 Jul – 30 Sep: gross 500,000 × 3% = 15,000.
      expect(res.body.businessTax).toMatchObject({ grossReceipts: 500000, due: 15000 });
    });

    it("with 2025 records added, year=2026 is unchanged and year=2025 covers 2025 only", async () => {
      await sale("alpha", "2025-11-01", 1000000, "NON_VAT");
      await cost("alpha", "2025-12-01", 200000);
      const y26 = await estimate(ids.alpha!, "?year=2026");
      expect(y26.body.incomeTax.due).toBe(107500);
      expect(y26.body.businessTax.due).toBe(30000);
      const y25 = await estimate(ids.alpha!, "?year=2025");
      expect(y25.status).toBe(200);
      // 2025: gross 1,000,000; deductible 200,000; taxable 800,000 (not over 800,000)
      // → 22,500 + (800,000 − 400,000) × 20% = 102,500. Percentage tax 30,000.
      expect(y25.body.incomeTax).toMatchObject({
        grossIncome: 1000000,
        deductibleExpenses: 200000,
        taxableIncome: 800000,
        due: 102500,
      });
      expect(y25.body.businessTax.due).toBe(30000);
    });

    it("a held record changes nothing", async () => {
      await cost("alpha", "2026-06-01", 500000, { status: "held" });
      const res = await estimate(ids.alpha!, "?year=2026");
      expect(res.body.incomeTax).toMatchObject({
        deductibleExpenses: 180000,
        due: 107500,
      });
    });
  });

  it("T1 · simplified8: 8% × (gross − 250,000), no percentage tax, and the assumption stated", async () => {
    const res = await estimate(ids.bravo!, "?year=2026");
    expect(res.status).toBe(200);
    // 8% × (1,000,000 − 250,000) = 60,000. The 100,000 cost is not deducted under 8%.
    expect(res.body.method).toMatchObject({ name: "simplified8", source: "saved" });
    expect(res.body.incomeTax).toMatchObject({ grossIncome: 1000000, due: 60000 });
    expect(res.body.businessTax).toMatchObject({ kind: "percentage", due: 0 });
    expect(res.body.assumptions.join(" ")).toContain(SIMPLIFIED8_ASSUMPTION);
  });

  it("T1 · an exempt client: income tax by its rule, and no business tax", async () => {
    const res = await estimate(ids.charlie!, "?year=2026");
    expect(res.status).toBe(200);
    // Taxable 400,000 → (400,000 − 250,000) × 15% = 22,500.
    expect(res.body.incomeTax).toMatchObject({ taxableIncome: 400000, due: 22500 });
    expect(res.body.businessTax).toMatchObject({ kind: "none", due: 0 });
  });

  it("T1 · a VAT client: output VAT minus input VAT", async () => {
    const res = await estimate(ids.delta!, "?year=2026");
    expect(res.status).toBe(200);
    // Income tax: taxable 500,000 − 200,000 = 300,000 → 50,000 × 15% = 7,500.
    // VAT: 60,000 − 24,000 = 36,000.
    expect(res.body.incomeTax).toMatchObject({ taxableIncome: 300000, due: 7500 });
    expect(res.body.businessTax).toMatchObject({
      kind: "vat",
      outputVAT: 60000,
      inputVAT: 24000,
      due: 36000,
    });
  });

  it("T1 · flat and percentage rules use the saved rate", async () => {
    // Flat 25%: taxable (600,000 − 100,000) × 25% = 125,000.
    const flat = await estimate(ids.echo!, "?year=2026");
    expect(flat.body.method).toMatchObject({ name: "flat", rate: 25 });
    expect(flat.body.incomeTax).toMatchObject({ taxableIncome: 500000, due: 125000 });
    // "percentage" at 1%: gross receipts 600,000 × 1% = 6,000.
    const pct = await estimate(ids.foxtrot!, "?year=2026");
    expect(pct.body.method).toMatchObject({ name: "percentage", rate: 1 });
    expect(pct.body.incomeTax).toMatchObject({ grossIncome: 600000, due: 6000 });
  });

  it("T1 · filed returns that cover the period come with the estimate, with their key figures (R4)", async () => {
    const filed = (period: string) =>
      writer.birForm.create({
        data: {
          firmId,
          clientId: ids.alpha!,
          form: "2551Q",
          period,
          status: "filed",
          filedAt: new Date("2026-07-20T02:00:00.000Z"),
          dataJson: {},
        },
      });
    const q2 = (await filed("2026-Q2")).id;
    const q4 = (await filed("2026-Q4")).id;
    const lastYear = (await filed("2025-Q4")).id;
    const forms = (res: request.Response) =>
      (res.body.filedForms as Array<{ id: string; figures: unknown }>).map((f) => f.id);
    // Q3 2026 covers January to September: the Q2 return, not Q4, not 2025's.
    const q3 = await estimate(ids.alpha!, "?year=2026&quarter=3");
    expect(forms(q3)).toEqual([q2]);
    expect(q3.body.filedForms[0]).toMatchObject({
      form: "2551Q",
      period: "2026-Q2",
      figures: { totalTaxDue: expect.any(Number), totalPayable: expect.any(Number) },
    });
    expect(q3.body.notice).toContain("not the filed figure");
    // The 2026 year view lists both of 2026's returns.
    expect(forms(await estimate(ids.alpha!, "?year=2026")).sort()).toEqual(
      [q2, q4].sort(),
    );
    expect(forms(await estimate(ids.alpha!, "?year=2025"))).toEqual([lastYear]);
  });

  it("T1 · a client principal gets its own client's estimate and 403 on another", async () => {
    const def = DEFAULT_ROLES.find(
      (r) => r.name === "Client Viewer" && r.scope === "CLIENT",
    )!;
    const role = await writer.role.create({
      data: { name: "Client Viewer", scope: "CLIENT", isSystem: true },
    });
    for (const p of def.permissions) {
      const [resource, action] = p.split(":") as [string, string];
      const permission = await writer.permission.upsert({
        where: { resource_action: { resource, action } },
        update: {},
        create: { resource, action },
      });
      await writer.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
    const portal = await writer.user.create({
      data: {
        firmId,
        userType: "CLIENT",
        fullName: `${TAG} portal user`,
        email: `${TAG}-portal@example.com`,
        status: "ACTIVE",
        clientProfile: { create: { clientId: ids.alpha!, clientRole: "VIEWER" } },
        userRoles: { create: { roleId: role.id, clientScopeId: ids.alpha! } },
      },
    });
    const token = tokens.signAccess({
      id: portal.id,
      firmId,
      userType: "CLIENT",
      email: portal.email,
      clientId: ids.alpha!,
    });
    const own = await estimate(ids.alpha!, "?year=2026", token);
    expect(own.status).toBe(200);
    expect(own.body.incomeTax.due).toBe(107500);
    const other = await estimate(ids.delta!, "?year=2026", token);
    expect(other.status).toBe(403);
  });

  describe("T3 · two-factor stays on while it is reset (R5)", () => {
    async function twoFactorUser(key: string) {
      const secret = authenticator.generateSecret();
      const u = await writer.user.create({
        data: {
          firmId,
          userType: "FIRM",
          fullName: `${TAG} ${key}`,
          email: `${TAG}-${key}@example.com`,
          status: "ACTIVE",
          mfaEnabled: true,
          mfaSecret: secret,
          firmProfile: { create: { title: "Test" } },
        },
      });
      const access = tokens.signAccess({
        id: u.id,
        firmId,
        userType: "FIRM",
        email: u.email,
      });
      const signIn = (code: string) =>
        http()
          .post(`${API}/auth/mfa/verify`)
          .send({
            mfaToken: tokens.signMfa({
              id: u.id,
              firmId,
              userType: "FIRM",
              email: u.email,
            }),
            code,
          });
      return { id: u.id, secret, access, signIn };
    }
    const post = (path: string, token: string, body: object) =>
      http().post(`${API}${path}`).set("Authorization", `Bearer ${token}`).send(body);

    it("an abandoned re-enroll leaves two-factor on and the old code working", async () => {
      const u = await twoFactorUser("mfa-abandon");
      const enroll = await post("/auth/mfa/enroll", u.access, {
        code: authenticator.generate(u.secret),
      });
      expect(enroll.status).toBe(201);
      expect(enroll.body.secret).not.toBe(u.secret);
      const row = await writer.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(row.mfaEnabled).toBe(true);
      expect(row.mfaSecret).toBe(u.secret);
      expect((await u.signIn(authenticator.generate(u.secret))).status).toBe(201);
    });

    it("the old code works until the new one is confirmed; confirming swaps the secrets", async () => {
      const u = await twoFactorUser("mfa-swap");
      const enroll = await post("/auth/mfa/enroll", u.access, {
        code: authenticator.generate(u.secret),
      });
      const fresh = enroll.body.secret as string;
      // Before confirming: the old code signs in; the new one does not yet.
      expect((await u.signIn(authenticator.generate(u.secret))).status).toBe(201);
      expect((await u.signIn(authenticator.generate(fresh))).status).toBe(401);
      // A confirm with the OLD code does not prove the new secret.
      const wrong = await post("/auth/mfa/confirm", u.access, {
        code: authenticator.generate(u.secret),
      });
      expect(wrong.status).toBe(400);
      const ok = await post("/auth/mfa/confirm", u.access, {
        code: authenticator.generate(fresh),
      });
      expect(ok.status).toBe(201);
      const row = await writer.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(row.mfaEnabled).toBe(true);
      expect(row.mfaSecret).toBe(fresh);
      // After confirming: the new code signs in; the old one no longer does.
      expect((await u.signIn(authenticator.generate(fresh))).status).toBe(201);
      expect((await u.signIn(authenticator.generate(u.secret))).status).toBe(401);
    });
  });
});
