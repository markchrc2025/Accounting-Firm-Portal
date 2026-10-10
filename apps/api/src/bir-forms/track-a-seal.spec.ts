/**
 * track-a-seal.spec.ts — the seal, the snapshot and the amendment in the service (U3, T3).
 * Hermetic: Prisma, ClientsService, StorageService and AuditService are mocked.
 */
import { BadRequestException, ConflictException, RequestMethod } from "@nestjs/common";
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { BirFormsController } from "./bir-forms.controller";
import { BirFormsService } from "./bir-forms.service";
import { clientToTaxpayer } from "./client-mapping";
import { CreateBirFormSchema, UpdateBirFormSchema } from "./dto/bir-form.schemas";
import {
  R3_KEYS,
  readFiledSnapshot,
  snapshotToClient,
  takeFiledSnapshot,
} from "./filed-snapshot";
import { PERMISSIONS_KEY } from "../common/decorators/require-permissions.decorator";
import type { AuditService } from "../audit/audit.service";
import type { ClientsService } from "../clients/clients.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import type { AuthUser } from "../common/auth/auth-user";

const actor: AuthUser = { id: "u1", firmId: "f1", userType: "FIRM", email: "a@f.test" };

/** An invented client — nothing here is a real person. */
const CLIENT = {
  id: "c1",
  firmId: "f1",
  businessName: "Halimbawa Trading",
  kind: "non-individual",
  regName: "HALIMBAWA TRADING CORP",
  lastName: null,
  firstName: null,
  middleName: null,
  tradeName: "Halimbawa",
  tin: "000111222",
  branch: "00000",
  rdo: "000",
  rdoName: "RDO Halimbawa",
  address: "1 Halimbawa St",
  city: "Lungsod ng Halimbawa",
  zip: "0000",
  birthdate: null,
  incorpDate: new Date("2020-01-15T00:00:00.000Z"),
  email: "books@example.com",
  phone: "09000000000",
  citizenship: null,
  civilStatus: null,
  taxpayerType: "corporation",
  classification: "",
};

function formRow(over: Record<string, unknown> = {}) {
  return {
    id: "bf1",
    firmId: "f1",
    clientId: "c1",
    client: { businessName: CLIENT.businessName },
    form: "2551Q",
    status: "draft",
    period: "2026-Q2",
    dataJson: { rows: [{ atc: "PT010", taxable: "100000" }], payeeZip: "0000" },
    filedAt: null,
    sequence: 1,
    amendsId: null,
    filedSnapshotJson: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-02T00:00:00Z"),
    exports: [],
    ...over,
  };
}

function build(row: Record<string, unknown> = formRow()) {
  const birForm = {
    findMany: jest.fn().mockResolvedValue([row]),
    findFirst: jest.fn().mockResolvedValue(row),
    create: jest.fn().mockResolvedValue({ id: "bf2" }),
    update: jest.fn().mockResolvedValue({ id: row.id }),
  };
  const birFormExport = { create: jest.fn().mockResolvedValue({ id: "ex1" }) };
  const prisma = { birForm, birFormExport } as unknown as PrismaService;
  const clients = {
    assertInFirm: jest.fn().mockResolvedValue(CLIENT),
  } as unknown as ClientsService;
  const storage = {
    isEnabled: jest.fn().mockReturnValue(true),
    birFormExportKey: jest.fn(
      (_f: string, _id: string, file: string) => `bir-forms/f1/bf1/${file}`,
    ),
    putObject: jest.fn().mockResolvedValue(undefined),
    signedGetUrl: jest.fn().mockResolvedValue("https://signed.example/url"),
  } as unknown as StorageService;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  return {
    svc: new BirFormsService(prisma, clients, storage, audit),
    birForm,
    clients,
    storage,
    audit,
  };
}

const FILED = { status: "filed", filedAt: new Date("2026-07-20T02:00:00.000Z") };

describe("U3 T3 · update() on a filed form", () => {
  it("a filed return refuses any change with 409 naming the amendment, and writes nothing", async () => {
    const { svc, birForm } = build(formRow(FILED));
    const err = await svc
      .update(actor, "bf1", { data: { rows: [] } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getStatus()).toBe(409);
    expect((err as Error).message).toMatch(/amend/i);
    expect(birForm.update).not.toHaveBeenCalled();
  });
});

describe("U3 T3 · update() — the rest of the seal", () => {
  it("a filed 2307 refuses any change with 409 naming a new certificate, not an amendment", async () => {
    const { svc, birForm } = build(formRow({ ...FILED, form: "2307" }));
    const err = await svc
      .update(actor, "bf1", { period: "2026-Q3" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toMatch(/issue a new certificate/i);
    expect((err as Error).message).not.toMatch(/amendment/i);
    expect(birForm.update).not.toHaveBeenCalled();
  });

  it("the old Reopen (status → draft on a filed form) is refused with 409 and writes nothing", async () => {
    const { svc, birForm, audit } = build(formRow(FILED));
    await expect(svc.update(actor, "bf1", { status: "draft" })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(birForm.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("a seal error from the database (filed by someone else meanwhile) is answered 409, not 500", async () => {
    const { svc, birForm } = build(formRow());
    birForm.update.mockRejectedValueOnce(
      new Error(
        "Raw query failed. Message: BIR_FORM_SEALED: UPDATE of filed BIR form bf1 refused",
      ),
    );
    await expect(svc.update(actor, "bf1", { data: {} })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("any other database error still propagates as itself", async () => {
    const { svc, birForm } = build(formRow());
    birForm.update.mockRejectedValueOnce(new Error("connection reset"));
    await expect(svc.update(actor, "bf1", { data: {} })).rejects.toThrow(
      "connection reset",
    );
  });

  it("a draft keeps its data verbatim, unknown keys included (R6)", async () => {
    const { svc, birForm } = build(formRow());
    const data = {
      rows: [],
      payeeZip: "0000",
      payeeForeignAddress: "x",
      signatoryName: "S",
      anything: { nested: 1 },
    };
    await svc.update(actor, "bf1", { data });
    expect(birForm.update.mock.calls[0][0].data.dataJson).toEqual(data);
  });
});

describe("U3 T3 · filing writes the snapshot (D12, R3)", () => {
  it("draft → filed writes status, filedAt and filedSnapshotJson in one update, with the R3 keys and the client's raw values", async () => {
    const { svc, birForm, audit } = build(formRow());
    await svc.update(actor, "bf1", { status: "filed" });
    expect(birForm.update).toHaveBeenCalledTimes(1);
    const data = birForm.update.mock.calls[0][0].data;
    expect(data.status).toBe("filed");
    expect(data.filedAt).toBeInstanceOf(Date);
    const snap = data.filedSnapshotJson;
    for (const k of R3_KEYS) expect(Object.keys(snap)).toContain(k);
    expect(snap).toMatchObject({
      businessName: CLIENT.businessName,
      tin: CLIENT.tin,
      branch: CLIENT.branch,
      address: CLIENT.address,
      city: CLIENT.city,
      zip: CLIENT.zip,
      rdo: CLIENT.rdo,
      kind: CLIENT.kind,
      regName: CLIENT.regName,
      lastName: null,
      firstName: null,
      middleName: null,
      incorpDate: "2020-01-15",
      birthdate: null,
      clientId: "c1",
      snapshotVersion: 1,
    });
    expect(snap.takenAt).toBe((data.filedAt as Date).toISOString());
    expect((audit.record as jest.Mock).mock.calls[0][0].metadata).toMatchObject({
      snapshot: "taken at filing",
    });
  });

  it("a draft save that does not file takes no snapshot and sets no filedAt", async () => {
    const { svc, birForm, clients } = build(formRow());
    await svc.update(actor, "bf1", { data: { rows: [] } });
    const data = birForm.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("filedSnapshotJson");
    expect(data).not.toHaveProperty("filedAt");
    expect(clients.assertInFirm).not.toHaveBeenCalled();
  });

  it("the snapshot survives JSON (the database boundary) and maps back to the same taxpayer the export used to read", () => {
    const individual = {
      ...CLIENT,
      kind: "individual",
      regName: null,
      lastName: "HALIMBAWA",
      firstName: "JUANA",
      middleName: "SUBOK",
      birthdate: new Date("1980-01-01T00:00:00.000Z"),
      incorpDate: null,
    };
    for (const c of [CLIENT, individual]) {
      const stored = JSON.parse(
        JSON.stringify(takeFiledSnapshot(c, new Date("2026-07-20T02:00:00Z"))),
      );
      expect(clientToTaxpayer(snapshotToClient(readFiledSnapshot(stored)!))).toEqual(
        clientToTaxpayer(c),
      );
    }
  });

  it("an unreadable stored snapshot is refused, never silently replaced by the live client", () => {
    expect(() => readFiledSnapshot({ businessName: 1 })).toThrow(/unreadable/);
    expect(readFiledSnapshot(null)).toBeNull();
  });
});

describe("U3 T3 · amend()", () => {
  it("a filed 2551Q → a draft with sequence 2, amendsId set, data copied verbatim; the original is not written; the audit row", async () => {
    const original = formRow({
      ...FILED,
      dataJson: {
        rows: [{ atc: "PT010", taxable: "100000", rate: "3" }],
        payeeBranch: "00000",
      },
    });
    const { svc, birForm, audit } = build(original);
    birForm.findFirst
      .mockResolvedValueOnce(original) // loadOwned
      .mockResolvedValueOnce(null); // no amendment yet
    const res = await svc.amend(actor, "bf1");
    expect(res).toEqual({ id: "bf2", status: "draft", sequence: 2, amendsId: "bf1" });
    expect(Object.keys(res).sort()).toEqual(["amendsId", "id", "sequence", "status"]);
    expect(birForm.create).toHaveBeenCalledWith({
      data: {
        firmId: "f1",
        clientId: "c1",
        form: "2551Q",
        period: "2026-Q2",
        status: "draft",
        dataJson: original.dataJson,
        sequence: 2,
        amendsId: "bf1",
      },
    });
    expect(birForm.update).not.toHaveBeenCalled();
    expect((audit.record as jest.Mock).mock.calls[0][0]).toMatchObject({
      action: "bir-form.amended",
      entityId: "bf2",
      metadata: { amendsId: "bf1", sequence: 2 },
    });
  });

  it("amending a filed amendment (sequence 2) makes sequence 3, pointing at the amendment", async () => {
    const amendment = formRow({ ...FILED, id: "bf2", sequence: 2, amendsId: "bf1" });
    const { svc, birForm } = build(amendment);
    birForm.findFirst.mockResolvedValueOnce(amendment).mockResolvedValueOnce(null);
    birForm.create.mockResolvedValueOnce({ id: "bf3" });
    await expect(svc.amend(actor, "bf2")).resolves.toEqual({
      id: "bf3",
      status: "draft",
      sequence: 3,
      amendsId: "bf2",
    });
  });

  it.each(["2307", "2316"])(
    "a filed %s answers 400: a certificate has no amendment, a new certificate corrects it",
    async (form) => {
      const { svc, birForm } = build(formRow({ ...FILED, form }));
      const err = await svc.amend(actor, "bf1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toMatch(
        new RegExp(`${form} is a certificate and has no amendment`),
      );
      expect((err as Error).message).toMatch(/issue a new certificate/);
      expect(birForm.create).not.toHaveBeenCalled();
    },
  );

  it("a draft return answers 400 and creates nothing", async () => {
    const { svc, birForm } = build(formRow());
    await expect(svc.amend(actor, "bf1")).rejects.toBeInstanceOf(BadRequestException);
    expect(birForm.create).not.toHaveBeenCalled();
  });

  it("a return that already has an amendment answers 409 naming it, and creates nothing", async () => {
    const original = formRow(FILED);
    const { svc, birForm } = build(original);
    birForm.findFirst
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce({ id: "bf2", sequence: 2 });
    const err = await svc.amend(actor, "bf1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toMatch(/already been amended \(amendment 2\)/);
    expect(birForm.create).not.toHaveBeenCalled();
  });

  it("two amendments racing: the unique index refusal (P2002) is answered 409", async () => {
    const original = formRow(FILED);
    const { svc, birForm } = build(original);
    birForm.findFirst.mockResolvedValueOnce(original).mockResolvedValueOnce(null);
    birForm.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed on amendsId"), { code: "P2002" }),
    );
    await expect(svc.amend(actor, "bf1")).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("U3 T3 · export reads the snapshot (D12)", () => {
  const SNAP = takeFiledSnapshot(
    { ...CLIENT, tin: "000999888", businessName: "Then Trading" },
    new Date("2026-07-20T02:00:00Z"),
  );

  it("a filed form with a snapshot exports the taxpayer as filed — not the client as it reads today — and the audit says so", async () => {
    const { svc, storage, audit } = build(formRow({ ...FILED, filedSnapshotJson: SNAP }));
    const res = await svc.exportForm(actor, "bf1");
    expect(res.filename.startsWith("000999888")).toBe(true); // the TIN at filing, not today's 000111222
    const xml = new TextDecoder().decode(
      (storage.putObject as jest.Mock).mock.calls[0][1],
    );
    expect(xml).toContain("frm2551Qv2018:txtTIN2=999");
    expect(xml).toContain("frm2551Qv2018:txtTIN3=888");
    expect(xml).not.toContain("frm2551Qv2018:txtTIN2=111"); // today's client TIN is 000-111-222
    expect((audit.record as jest.Mock).mock.calls[0][0].metadata).toMatchObject({
      kind: "xml",
      snapshot: "used",
      snapshotTakenAt: "2026-07-20T02:00:00.000Z",
    });
  });

  it("a filed form without a snapshot (filed before U3) reads the live client and the audit row is marked none (pre-U3)", async () => {
    const { svc, audit } = build(formRow(FILED));
    const res = await svc.exportForm(actor, "bf1");
    expect(res.filename.startsWith("000111222")).toBe(true);
    expect((audit.record as jest.Mock).mock.calls[0][0].metadata).toMatchObject({
      snapshot: "none (pre-U3)",
    });
  });

  it("a draft has no snapshot yet: it reads the live client and the audit row says none (draft)", async () => {
    const { svc, audit } = build(formRow());
    await svc.exportForm(actor, "bf1");
    expect((audit.record as jest.Mock).mock.calls[0][0].metadata).toMatchObject({
      snapshot: "none (draft)",
    });
  });
});

describe("U3 T3 · GET and the list carry amendsId, sequence and filedSnapshot (R6, additive)", () => {
  it("getOne and list return the three keys", async () => {
    const SNAP = takeFiledSnapshot(CLIENT, new Date("2026-07-20T02:00:00Z"));
    const row = formRow({
      ...FILED,
      sequence: 2,
      amendsId: "bf0",
      filedSnapshotJson: SNAP,
    });
    const { svc } = build(row);
    const one = await svc.getOne(actor, "bf1");
    expect(one).toMatchObject({ sequence: 2, amendsId: "bf0", filedSnapshot: SNAP });
    const list = await svc.list(actor);
    expect(list[0]).toMatchObject({ sequence: 2, amendsId: "bf0", filedSnapshot: SNAP });
  });

  it("an original without a snapshot reads sequence 1, amendsId null, filedSnapshot null", async () => {
    const { svc } = build(formRow());
    expect(await svc.getOne(actor, "bf1")).toMatchObject({
      sequence: 1,
      amendsId: null,
      filedSnapshot: null,
    });
  });
});

describe("U3 T3 · the amend route", () => {
  const proto = BirFormsController.prototype;
  it("is POST :id/amend, needs BIRForms:Create (same as create), and keeps Nest's default 201", () => {
    expect(Reflect.getMetadata(PATH_METADATA, proto.amend)).toBe(":id/amend");
    expect(Reflect.getMetadata(METHOD_METADATA, proto.amend)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.amend)).toBeUndefined(); // no @HttpCode override → 201
    const perms = (fn: unknown) => Reflect.getMetadata(PERMISSIONS_KEY, fn as object);
    expect(perms(proto.amend)).toEqual(perms(proto.create));
    expect(perms(proto.amend)).toEqual(["BIRForms:Create"]);
  });
});

describe("U3 T3 · an amendment keeps the period of the return it amends (review finding)", () => {
  const AMENDMENT = { id: "bf2", sequence: 2, amendsId: "bf1", period: "2026-Q1" };

  it("a PATCH moving an amendment draft to another period answers 400 and writes nothing", async () => {
    const { svc, birForm } = build(formRow(AMENDMENT));
    const err = await svc
      .update(actor, "bf2", { period: "2026-Q2", data: {} })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toMatch(
      /amends the 2551Q for 2026-Q1 and keeps that period/,
    );
    expect(birForm.update).not.toHaveBeenCalled();
  });

  it("the same period (every editor save sends it) and an original draft's period change are still accepted", async () => {
    const a = build(formRow(AMENDMENT));
    await a.svc.update(actor, "bf2", { period: "2026-Q1", data: { rows: [] } });
    expect(a.birForm.update).toHaveBeenCalledTimes(1);
    const o = build(formRow());
    await o.svc.update(actor, "bf1", { period: "2026-Q3" });
    expect(o.birForm.update.mock.calls[0][0].data.period).toBe("2026-Q3");
  });
});

describe("U3 T3 · R6: the request schemas keep unknown dataJson keys", () => {
  const data = {
    rows: [{ atc: "WC010", desc: "row description" }],
    payeeZip: "0000",
    payeeForeignAddress: "1 Example Rd",
    payeeBranch: "00000",
    signatoryName: "S",
    nested: { anything: [1, "two", null] },
  };

  it("UpdateBirFormSchema and CreateBirFormSchema pass dataJson through untouched", () => {
    expect(UpdateBirFormSchema.parse({ data }).data).toEqual(data);
    expect(
      CreateBirFormSchema.parse({
        clientId: "00000000-0000-4000-8000-000000000001",
        form: "2307",
        data,
      }).data,
    ).toEqual(data);
  });
});
