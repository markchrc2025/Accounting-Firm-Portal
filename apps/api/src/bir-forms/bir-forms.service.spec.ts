import { BadRequestException } from "@nestjs/common";
import { BirFormsService } from "./bir-forms.service";
import type { AuditService } from "../audit/audit.service";
import type { ClientsService } from "../clients/clients.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import type { AuthUser } from "../common/auth/auth-user";

const actor: AuthUser = { id: "u1", firmId: "f1", userType: "FIRM", email: "a@f.test" };

const CLIENT = {
  id: "c1",
  businessName: "Acme",
  kind: "individual",
  regName: null,
  lastName: "DELA CRUZ",
  firstName: "JUAN",
  middleName: "",
  tradeName: null,
  tin: "123456789",
  branch: "00000",
  rdo: "044",
  rdoName: null,
  address: "1 Main St",
  city: "Makati",
  zip: "1200",
  birthdate: null,
  incorpDate: null,
  email: "juan@acme.test",
  phone: "0917",
  citizenship: "FILIPINO",
  civilStatus: "single",
  taxpayerType: "single",
  classification: "",
};

function build(over: Record<string, unknown> = {}) {
  const birForm = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue({
      id: "bf1",
      firmId: "f1",
      clientId: "c1",
      client: { businessName: "Acme" },
      form: "2551Q",
      status: "draft",
      period: "2026-Q1",
      dataJson: { rows: [{ atc: "PT010", taxable: "1000000", rate: "3" }] },
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-02T00:00:00Z"),
      exports: [],
    }),
    create: jest.fn().mockResolvedValue({ id: "bf1" }),
    update: jest.fn().mockResolvedValue({ id: "bf1" }),
    ...over,
  };
  const birFormExport = {
    create: jest.fn().mockResolvedValue({ id: "ex1" }),
    findFirst: jest.fn().mockResolvedValue({ id: "ex1", storageKey: "k" }),
  };
  const prisma = { birForm, birFormExport } as unknown as PrismaService;
  const clients = {
    assertInFirm: jest.fn().mockResolvedValue(CLIENT),
  } as unknown as ClientsService;
  const storage = {
    isEnabled: jest.fn().mockReturnValue(true),
    birFormExportKey: jest.fn().mockReturnValue("bir-forms/f1/bf1/file.xml"),
    putObject: jest.fn().mockResolvedValue(undefined),
    signedGetUrl: jest.fn().mockResolvedValue("https://signed/url"),
  } as unknown as StorageService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return { svc: new BirFormsService(prisma, clients, storage, audit), prisma, clients, storage, birForm };
}

describe("BirFormsService", () => {
  it("marks 2551Q available in the catalog", () => {
    const cat = build().svc.catalog();
    expect(cat).toHaveLength(9);
    expect(cat.every((f) => f.status === "available")).toBe(true);
    expect(cat.filter((f) => !f.xmlExport).map((f) => f.code)).toEqual(["2307", "2316"]);
    expect(cat.find((f) => f.code === "2551Q")?.status).toBe("available");
  });

  it("computes 2551Q authoritatively (preview)", () => {
    const c = build().svc.computePreview("2551Q", {
      rows: [{ atc: "PT010", taxable: "1000000", rate: "3" }],
    }) as { i14: number; i24: number };
    expect(c.i14).toBe(30000);
    expect(c.i24).toBe(30000);
  });

  it("computes 2550Q authoritatively (preview)", () => {
    const c = build().svc.computePreview("2550Q", { i31a: "1000000", i44b: "50000" }) as {
      i34b: number;
      i61: number;
      i26: number;
    };
    expect(c.i34b).toBe(120000); // 12% output tax
    expect(c.i61).toBe(70000); // net VAT payable
    expect(c.i26).toBe(70000); // total payable
  });

  it("computes 1701Q authoritatively (preview)", () => {
    const c = build().svc.computePreview("1701Q", {
      year: "2024",
      salesA: "500000",
      rateA: "eight",
    }) as { A: { taxDue: number }; aggregate: number };
    expect(c.A.taxDue).toBe(20000); // (500k - 250k) * 8%
    expect(c.aggregate).toBe(20000);
  });

  it("computes the annual individual returns (1701A + 1701)", () => {
    const { svc } = build();
    const a = svc.computePreview("1701A", {
      taxRate: "graduated",
      year: "2024",
      i36A: "1000000",
    }) as { A: { taxDue: number }; i30: number };
    expect(a.A.taxDue).toBe(62500); // ₱1M less 40% OSD → ₱600k graduated
    expect(a.i30).toBe(62500);

    const full = svc.computePreview("1701", {
      year: "2024",
      compA: "500000",
      salesA: "1000000",
      methodA: "osd",
      rateA: "graduated",
    }) as { A: { taxDue: number }; aggregate: number };
    expect(full.A.taxDue).toBe(177500); // graduated on comp + net business
    expect(full.aggregate).toBe(177500);
  });

  it("computes the corporate returns (1702Q + 1702RT), MCIT-aware", () => {
    const { svc } = build();
    const q = svc.computePreview("1702Q", {
      s2_1: "2000000",
      s2_2: "1000000",
      method: "itemized",
      s2_6: "200000",
    }) as { s2_11: number; mcit: number; i14: number };
    expect(q.s2_11).toBe(200000); // normal rate 25%
    expect(q.mcit).toBe(20000); // MCIT 2% of gross
    expect(q.i14).toBe(200000); // the higher of the two

    const rt = svc.computePreview("1702RT", {
      i27: "1000000",
      i30: "0",
      method: "itemized",
      i34: "980000",
    }) as { i41: number; i42: number; i43: number; mcitApplies: boolean };
    expect(rt.i41).toBe(5000); // normal rate on the small taxable base
    expect(rt.i42).toBe(20000); // MCIT 2% of gross
    expect(rt.i43).toBe(20000); // MCIT wins
    expect(rt.mcitApplies).toBe(true);
  });

  it("computes the withholding certificates (2307 + 2316)", () => {
    const { svc } = build();
    const c2307 = svc.computePreview("2307", {
      rows: [{ atc: "WI010", m1: "100000", m2: "100000", m3: "100000", tax: "15000" }],
    }) as { totalIncome: number; totalTax: number };
    expect(c2307.totalIncome).toBe(300000);
    expect(c2307.totalTax).toBe(15000);

    const c2316 = svc.computePreview("2316", { year: "2024", i39: "500000" }) as {
      i23: number;
      i24: number;
    };
    expect(c2316.i23).toBe(500000);
    expect(c2316.i24).toBe(42500); // graduated on gross taxable comp
  });

  it("rejects a form code the engine does not implement", () => {
    expect(() => build().svc.computePreview("1702EX", {})).toThrow(BadRequestException);
  });

  it("refuses XML export for a certificate (2307 has no eBIRForms XML)", async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: "bf3",
      firmId: "f1",
      clientId: "c1",
      client: { businessName: "Acme" },
      form: "2307",
      status: "draft",
      period: "2026-Q1",
      dataJson: { rows: [] },
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-02T00:00:00Z"),
      exports: [],
    });
    const { svc, storage } = build({ findFirst });
    await expect(svc.exportForm(actor, "bf3")).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it("creates a draft only for a same-firm client", async () => {
    const { svc, clients, birForm } = build();
    await svc.create(actor, { clientId: "c1", form: "2551Q", period: "2026-Q1", data: {} });
    expect(clients.assertInFirm).toHaveBeenCalledWith("f1", "c1");
    expect(birForm.create).toHaveBeenCalled();
  });

  it("won't create an unsupported form", async () => {
    const { svc } = build();
    await expect(
      svc.create(actor, { clientId: "c1", form: "1702EX", period: "", data: {} }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("exports the eBIRForms XML to storage and records it", async () => {
    const { svc, storage } = build();
    const res = await svc.exportForm(actor, "bf1");
    expect(storage.putObject).toHaveBeenCalled();
    const [, body, contentType] = (storage.putObject as jest.Mock).mock.calls[0];
    expect(new TextDecoder().decode(body)).toContain("frm2551Qv2018:txt14=");
    expect(contentType).toBe("application/xml");
    expect(res).toEqual(expect.objectContaining({ kind: "xml", url: "https://signed/url" }));
  });

  it("exports 2550Q XML with the frm2550qv2024 namespace", async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: "bf2",
      firmId: "f1",
      clientId: "c1",
      client: { businessName: "Acme" },
      form: "2550Q",
      status: "draft",
      period: "2026-Q1",
      dataJson: { i31a: "1000000" },
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-02T00:00:00Z"),
      exports: [],
    });
    const { svc, storage } = build({ findFirst });
    await svc.exportForm(actor, "bf2");
    const [, body] = (storage.putObject as jest.Mock).mock.calls[0];
    expect(new TextDecoder().decode(body)).toContain("frm2550qv2024:netVatPayable=");
  });

  it("won't export when storage is unconfigured", async () => {
    const { svc, storage } = build();
    (storage.isEnabled as jest.Mock).mockReturnValue(false);
    await expect(svc.exportForm(actor, "bf1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("lists filed forms with their authoritative key figures", async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "bf1",
        firmId: "f1",
        clientId: "c1",
        client: { businessName: "Acme" },
        form: "2551Q",
        status: "filed",
        period: "2026-Q1",
        filedAt: new Date("2026-07-05T00:00:00Z"),
        dataJson: { rows: [{ atc: "PT010", taxable: "1000000", rate: "3" }] },
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-02T00:00:00Z"),
      },
    ]);
    const { svc, birForm } = build({ findMany });
    const rows = (await svc.listFiled(actor, "c1")) as Array<{
      status: string;
      filedAt: string | null;
      figures: { totalTaxDue: number; totalPayable: number } | null;
    }>;
    expect(birForm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "filed", clientId: "c1" }) }),
    );
    expect(rows[0]?.figures).toEqual({ totalTaxDue: 30000, totalPayable: 30000 });
    expect(rows[0]?.filedAt).toBe("2026-07-05T00:00:00.000Z");
  });

  it("stamps filedAt when a form is marked filed", async () => {
    const { svc, birForm } = build();
    await svc.update(actor, "bf1", { status: "filed" });
    const data = (birForm.update as jest.Mock).mock.calls[0][0].data;
    expect(data.status).toBe("filed");
    expect(data.filedAt).toBeInstanceOf(Date);
  });

  it("clears filedAt when a form is reopened to draft", async () => {
    const { svc, birForm } = build();
    await svc.update(actor, "bf1", { status: "draft" });
    const data = (birForm.update as jest.Mock).mock.calls[0][0].data;
    expect(data.status).toBe("draft");
    expect(data.filedAt).toBeNull();
  });
});
