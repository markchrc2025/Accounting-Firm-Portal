/**
 * track-a-delete-client.db-spec.ts — U25 (D72): delete a client. Over HTTP against the real Nest
 * app and the local PostgreSQL, with an in-memory object store that can be told to fail. Every
 * firm, client, TIN and name is invented.
 *
 * X1  A client with only drafts, transactions, scans and files: delete-check lists what will go,
 *     DELETE removes the client and every child, the counts are right and match delete-check,
 *     the stored files are removed, a linked FS report stays unlinked, another client is untouched.
 * X2  Each blocker refuses with its sentence and deletes nothing; two blockers share one sentence.
 * X3  A delete that fails half way is rolled back: everything is still there.
 * X4  Another firm's client is 404.
 * X5  Permission: Super Admin yes; Manager, Accountant, Staff, Auditor and a client user no.
 * X6  confirmName: a mismatch (or none) is 400 with the one sentence; case and spaces are folded.
 * X7  The audit event client.deleted: who, the registered name and TIN, the counts, nothing else.
 * X8  A stored file that fails to delete is listed in the answer, and the delete stands.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { FakeStorage } from "../helpers/file-return";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { StorageService } from "../../src/storage/storage.service";

const ROLES = ["Super Admin", "Manager", "Accountant", "Staff", "Auditor"];
truncateOncePerFile({ firmRoles: ROLES });

const TAG = `track-a-del-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
const REG_NAME = "HALIMBAWA TRADING CORP";
const TIN = "000555888";
const TYPE_NAME = "Type the client's name exactly to delete it.";

/** A store whose deletes can be told to fail for chosen keys. */
class FlakyStorage extends FakeStorage {
  failing = new Set<string>();
  override async deleteObject(key: string) {
    if (this.failing.has(key)) throw new Error("object storage is down");
    return super.deleteObject(key);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read response JSON
type Json = Record<string, any>;

describe("U25 · delete a client (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  const storage = new FlakyStorage();
  let firmId = "";
  const tokens: Record<string, string> = {};
  const users: Record<string, string> = {};
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const as = (who: string, r: request.Test) =>
    r.set("Authorization", `Bearer ${tokens[who]}`);
  const check = (id: string, who = "Super Admin") =>
    as(who, http().get(`${API}/clients/${id}/delete-check`));
  const del = (id: string, body: object | undefined, who = "Super Admin") => {
    const r = as(who, http().delete(`${API}/clients/${id}`));
    return body === undefined ? r : r.send(body);
  };

  async function newClient(extra: Record<string, unknown> = {}, inFirm = firmId) {
    seq += 1;
    return db.client.create({
      data: {
        firmId: inFirm,
        kind: "non-individual",
        regName: REG_NAME,
        businessName: `${TAG} Halimbawa Trading ${seq}`,
        taxType: "VAT",
        tin: TIN,
        ...extra,
      },
    });
  }

  /** Everything that belongs only to a client, written straight to the database. */
  async function fullClient() {
    const c = await newClient();
    const corKey = `${firmId}/${c.id}`;
    await storage.putObject(corKey, new Uint8Array([1]), "application/pdf");
    await db.client.update({ where: { id: c.id }, data: { corPath: corKey } });

    const inc = await db.category.create({
      data: { clientId: c.id, type: "INCOME", name: "Sales" },
    });
    const exp = await db.category.create({
      data: { clientId: c.id, type: "EXPENSE", name: "Supplies" },
    });
    for (let i = 0; i < 3; i++) {
      await db.incomeTransaction.create({
        data: {
          clientId: c.id,
          categoryId: inc.id,
          txnDate: new Date("2026-08-0" + (i + 1)),
          description: `sale ${i}`,
          netAmount: "100.00",
          vatClass: "VATABLE_12",
        },
      });
    }
    for (let i = 0; i < 2; i++) {
      await db.purchaseTransaction.create({
        data: {
          clientId: c.id,
          categoryId: exp.id,
          txnDate: new Date("2026-08-0" + (i + 1)),
          description: `purchase ${i}`,
          netAmount: "50.00",
        },
      });
    }

    const drafts = [];
    for (const form of ["2551Q", "0619E"]) {
      drafts.push(
        await db.birForm.create({
          data: { firmId, clientId: c.id, form, period: "2026-Q3", status: "draft" },
        }),
      );
    }
    const exportKey = `bir-forms/${firmId}/${drafts[0]!.id}/preview.pdf`;
    await storage.putObject(exportKey, new Uint8Array([2]), "application/pdf");
    await db.birFormExport.create({
      data: {
        birFormId: drafts[0]!.id,
        kind: "pdf",
        storageKey: exportKey,
        filename: "preview.pdf",
      },
    });
    for (const [status, start, end] of [
      ["draft", "2026-01-01", "2026-03-31"],
      ["ready", "2026-04-01", "2026-06-30"],
    ] as const) {
      await db.bIRFiling.create({
        data: {
          clientId: c.id,
          form: "2550Q",
          periodType: "quarter",
          periodStart: new Date(start),
          periodEnd: new Date(end),
          status,
          xmlFilename: "x.xml",
          xmlBase64: "",
        },
      });
    }

    const scan = await db.receiptScan.create({
      data: {
        firmId,
        clientId: c.id,
        periodFrom: new Date("2026-08-01"),
        periodTo: new Date("2026-08-31"),
        model: "test",
        promptVersion: "v1",
        month: "2026-08",
        estimatedUsd: "0.10",
      },
    });
    const scanKeys: string[] = [];
    for (let i = 0; i < 2; i++) {
      const key = `receipt-scans/${firmId}/${scan.id}/${i}.jpg`;
      scanKeys.push(key);
      await storage.putObject(key, new Uint8Array([3]), "image/jpeg");
      const file = await db.receiptScanFile.create({
        data: {
          scanId: scan.id,
          clientId: c.id,
          position: i,
          name: `${i}.jpg`,
          contentType: "image/jpeg",
          bytes: 1,
          sha256: `${TAG}-${c.id}-${i}`,
          storageKey: key,
          promptVersion: "v1",
          estimatedUsd: "0.01",
        },
      });
      await db.receiptScanRow.create({
        data: {
          scanId: scan.id,
          fileId: file.id,
          position: i,
          cellsJson: {},
          checkJson: {},
        },
      });
    }

    await db.inputTaxAsset.create({
      data: {
        clientId: c.id,
        sourceForm: "2550Q",
        asOfYear: 2026,
        asOfQuarter: 2,
        excessInputTaxCarriedForward: "1.00",
        deferredCapitalGoodsInputTax: "0.00",
        totalInputTaxAsset: "1.00",
        computedAt: new Date(),
      },
    });
    await db.taxRule.create({ data: { clientId: c.id, method: "graduated" } });
    await db.invoice.create({
      data: {
        firmId,
        clientId: c.id,
        number: `${TAG}-D-${seq}`,
        issuedDate: new Date("2026-08-01"),
        dueDate: new Date("2026-08-31"),
        status: "Draft",
        subtotal: "10.00",
        vat: "0.00",
        total: "10.00",
        lineItems: {
          create: [{ description: "Fee", qty: "1", rate: "10.00", amount: "10.00" }],
        },
      },
    });

    const clientUser = await db.user.create({
      data: {
        firmId,
        userType: "CLIENT",
        fullName: `${TAG} client user ${seq}`,
        email: `${TAG}-cu-${seq}@example.com`,
        status: "ACTIVE",
        clientProfile: { create: { clientId: c.id, clientRole: "OWNER" } },
      },
    });
    await db.invitation.create({
      data: {
        clientId: c.id,
        email: `${TAG}-inv-${seq}@example.com`,
        role: "VIEWER",
        token: `${TAG}-tok-${seq}`,
        expiresAt: new Date("2030-01-01"),
      },
    });
    const clientRole = await db.role.upsert({
      where: { name_scope: { name: `${TAG} client reader`, scope: "CLIENT" } },
      update: {},
      create: { name: `${TAG} client reader`, scope: "CLIENT" },
    });
    await db.userRole.create({
      data: { userId: clientUser.id, roleId: clientRole.id, clientScopeId: c.id },
    });
    await db.firmClientAssignment.create({
      data: { firmUserId: users.Accountant!, clientId: c.id },
    });
    const fs = await db.fsReport.create({
      data: {
        firmId,
        clientId: c.id,
        entityName: REG_NAME,
        createdById: users["Super Admin"]!,
      },
    });
    return { client: c, clientUser, fs, files: [corKey, exportKey, ...scanKeys] };
  }

  /** Every row of a client, per kind, read straight from the database. */
  async function rowsOf(clientId: string) {
    return {
      client: await db.client.count({ where: { id: clientId } }),
      incomeTransactions: await db.incomeTransaction.count({ where: { clientId } }),
      purchaseTransactions: await db.purchaseTransaction.count({ where: { clientId } }),
      categories: await db.category.count({ where: { clientId } }),
      birFormDrafts: await db.birForm.count({ where: { clientId } }),
      birFormDraftFiles: await db.birFormExport.count({
        where: { birForm: { clientId } },
      }),
      birFilings: await db.bIRFiling.count({ where: { clientId } }),
      receiptScans: await db.receiptScan.count({ where: { clientId } }),
      receiptScanFiles: await db.receiptScanFile.count({ where: { clientId } }),
      receiptScanRows: await db.receiptScanRow.count({ where: { scan: { clientId } } }),
      inputTaxAssets: await db.inputTaxAsset.count({ where: { clientId } }),
      taxRules: await db.taxRule.count({ where: { clientId } }),
      invoices: await db.invoice.count({ where: { clientId } }),
      clientUserProfiles: await db.clientUserProfile.count({ where: { clientId } }),
      invitations: await db.invitation.count({ where: { clientId } }),
      clientRoleGrants: await db.userRole.count({ where: { clientScopeId: clientId } }),
      staffAssignments: await db.firmClientAssignment.count({ where: { clientId } }),
      fsReportsLinked: await db.fsReport.count({ where: { clientId } }),
    };
  }

  const WILL_DELETE = [
    { kind: "incomeTransactions", count: 3 },
    { kind: "purchaseTransactions", count: 2 },
    { kind: "categories", count: 2 },
    { kind: "birFormDrafts", count: 2 },
    { kind: "birFormDraftFiles", count: 1 },
    { kind: "birFilingsNotFiled", count: 2 },
    { kind: "receiptScans", count: 1 },
    { kind: "receiptScanFiles", count: 2 },
    { kind: "inputTaxAssets", count: 1 },
    { kind: "taxRules", count: 1 },
    { kind: "draftInvoices", count: 1 },
    { kind: "corFiles", count: 1 },
    { kind: "clientUserProfiles", count: 1 },
    { kind: "invitations", count: 1 },
    { kind: "clientRoleGrants", count: 1 },
    { kind: "staffAssignments", count: 1 },
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get(PrismaService);
    firmId = (await db.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } })).id;
    const signer = app.get(TokenService);
    for (const name of ROLES) {
      const roleId = (
        await db.role.findUniqueOrThrow({
          where: { name_scope: { name, scope: "FIRM" } },
        })
      ).id;
      const u = await db.user.create({
        data: {
          firmId,
          userType: "FIRM",
          fullName: `${TAG} ${name}`,
          email: `${TAG}-${name.replace(/\s/g, "").toLowerCase()}@example.com`,
          status: "ACTIVE",
          firmProfile: { create: { title: "Test" } },
          userRoles: { create: { roleId } },
        },
      });
      users[name] = u.id;
      tokens[name] = signer.signAccess({
        id: u.id,
        firmId,
        userType: "FIRM",
        email: u.email,
      });
    }
  });
  afterAll(async () => {
    await app?.close();
  });

  describe("X1 · a client with only drafts, transactions, scans and files", () => {
    it("delete-check lists what will go; DELETE removes the client and every child, as it said", async () => {
      const keep = await fullClient(); // another client of the firm: untouched
      const keepBefore = await rowsOf(keep.client.id);
      const { client, fs, files } = await fullClient();

      const c = await check(client.id);
      expect(c.status).toBe(200);
      expect(c.body).toEqual({
        canDelete: true,
        nameToType: REG_NAME,
        blockers: [],
        willDelete: WILL_DELETE,
        willUnlink: [{ kind: "fsReports", count: 1 }],
      });

      const res = await del(client.id, { confirmName: REG_NAME });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        deleted: c.body.willDelete,
        unlinked: c.body.willUnlink,
        filesNotRemoved: [],
      });

      expect(await rowsOf(client.id)).toEqual({
        client: 0,
        incomeTransactions: 0,
        purchaseTransactions: 0,
        categories: 0,
        birFormDrafts: 0,
        birFormDraftFiles: 0,
        birFilings: 0,
        receiptScans: 0,
        receiptScanFiles: 0,
        receiptScanRows: 0,
        inputTaxAssets: 0,
        taxRules: 0,
        invoices: 0,
        clientUserProfiles: 0,
        invitations: 0,
        clientRoleGrants: 0,
        staffAssignments: 0,
        fsReportsLinked: 0,
      });
      // The FS report stays, unlinked, with the facts copied onto it.
      const report = await db.fsReport.findUniqueOrThrow({ where: { id: fs.id } });
      expect([report.clientId, report.entityName]).toEqual([null, REG_NAME]);
      // The stored files are gone; the other client's are not.
      for (const key of files)
        expect([key, storage.objects.has(key)]).toEqual([key, false]);
      for (const key of keep.files)
        expect([key, storage.objects.has(key)]).toEqual([key, true]);
      expect(await rowsOf(keep.client.id)).toEqual(keepBefore);
      // The client user's account stays; it no longer belongs to any client.
      expect(
        await db.user.count({ where: { email: { startsWith: `${TAG}-cu-` } } }),
      ).toBe(2);
    });

    it("a bare client: nothing to list, and it goes", async () => {
      const c = await newClient();
      const res = await check(c.id);
      expect(res.body).toEqual({
        canDelete: true,
        nameToType: REG_NAME,
        blockers: [],
        willDelete: [],
        willUnlink: [],
      });
      const d = await del(c.id, { confirmName: REG_NAME });
      expect(d.status).toBe(200);
      expect(d.body).toEqual({ deleted: [], unlinked: [], filesNotRemoved: [] });
      expect(await db.client.count({ where: { id: c.id } })).toBe(0);
    });

    it("an individual's name to type is LAST, FIRST MIDDLE; with no registered name, the client's name", async () => {
      const person = await newClient({
        kind: "individual",
        regName: null,
        lastName: "DELA CRUZ",
        firstName: "JUAN",
        middleName: "SANTOS",
      });
      expect((await check(person.id)).body.nameToType).toBe("DELA CRUZ, JUAN SANTOS");
      const bare = await newClient({ regName: null });
      expect((await check(bare.id)).body.nameToType).toBe(bare.businessName);
      expect((await del(bare.id, { confirmName: bare.businessName })).status).toBe(200);
    });
  });

  describe("X2 · each blocker refuses with its sentence and deletes nothing", () => {
    async function filedForm(clientId: string, form = "2551Q", period = "2026-Q1") {
      return db.birForm.create({
        data: {
          firmId,
          clientId,
          form,
          period,
          status: "filed",
          filedAt: new Date("2026-04-20T02:00:00.000Z"),
        },
      });
    }
    async function invoice(clientId: string, status: string, billedForClientId?: string) {
      seq += 1;
      return db.invoice.create({
        data: {
          firmId,
          clientId,
          number: `${TAG}-I-${seq}`,
          issuedDate: new Date("2026-08-01"),
          dueDate: new Date("2026-08-31"),
          status,
          subtotal: "10.00",
          vat: "0.00",
          total: "10.00",
          ...(billedForClientId ? { billedForClientId } : {}),
        },
      });
    }
    /** The client refuses with `sentence`, as a blocker and as the DELETE answer; nothing goes. */
    async function refuses(
      clientId: string,
      blockers: { kind: string; count: number; sentence: string }[],
      sentence: string,
    ) {
      const before = await rowsOf(clientId);
      const c = await check(clientId);
      expect(c.status).toBe(200);
      expect(c.body.canDelete).toBe(false);
      expect(c.body.blockers).toEqual(blockers);
      const res = await del(clientId, { confirmName: REG_NAME });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(sentence);
      expect(await rowsOf(clientId)).toEqual(before);
    }
    const one = (kind: string, count: number, phrase: string) => ({
      kind,
      count,
      sentence: `This client cannot be deleted: it has ${phrase}. Archive it instead.`,
    });

    it("a filed BIR return", async () => {
      const { client } = await fullClient();
      await filedForm(client.id);
      const b = one("filedBirReturns", 1, "1 filed BIR return");
      await refuses(client.id, [b], b.sentence);
    });

    it("a return whose filing was undone and still holds its filing history", async () => {
      const { client } = await fullClient();
      const f = await db.birForm.create({
        data: { firmId, clientId: client.id, form: "1601EQ", period: "2026-Q2" },
      });
      await db.birFormFilingUndo.create({
        data: {
          firmId,
          birFormId: f.id,
          filedAt: new Date("2026-07-30T02:00:00.000Z"),
          reason: "filed without the BIR email",
        },
      });
      const b = one("filedBirReturns", 1, "1 filed BIR return");
      await refuses(client.id, [b], b.sentence);
    });

    it("a filed BIRFiling row from the Generator", async () => {
      const { client } = await fullClient();
      await db.bIRFiling.create({
        data: {
          clientId: client.id,
          form: "2550Q",
          periodType: "quarter",
          periodStart: new Date("2025-10-01"),
          periodEnd: new Date("2025-12-31"),
          status: "filed",
          xmlFilename: "x.xml",
          xmlBase64: "",
        },
      });
      const b = one("filedBirReturns", 1, "1 filed BIR return");
      await refuses(client.id, [b], b.sentence);
    });

    it("an invoice that is not a draft (sent, paid or overdue)", async () => {
      const { client } = await fullClient();
      await invoice(client.id, "Sent");
      await invoice(client.id, "Paid");
      await invoice(client.id, "Overdue");
      const b = one("sentInvoices", 3, "3 sent invoices");
      await refuses(client.id, [b], b.sentence);
    });

    it("an invoice of another client that bills for it, even a draft", async () => {
      const { client } = await fullClient();
      const parent = await newClient();
      await invoice(parent.id, "Draft", client.id);
      const b = one(
        "billedForInvoices",
        1,
        "1 invoice billed for it under another client",
      );
      await refuses(client.id, [b], b.sentence);
    });

    it("a linked project", async () => {
      const { client } = await fullClient();
      for (const k of ["A", "B"]) {
        await db.project.create({
          data: {
            firmId,
            key: `DEL${seq}${k}`,
            name: `${TAG} project ${k}`,
            clientId: client.id,
            clientName: client.businessName,
          },
        });
      }
      const b = one("linkedProjects", 2, "2 linked projects");
      await refuses(client.id, [b], b.sentence);
    });

    it("a sub-client billed under it", async () => {
      const { client } = await fullClient();
      await newClient({ billingParentId: client.id });
      const b = one("subClients", 1, "1 sub-client billed under it");
      await refuses(client.id, [b], b.sentence);
    });

    it("two kinds at once: one sentence, the owner's example word for word", async () => {
      const { client } = await fullClient();
      await filedForm(client.id, "2551Q", "2026-Q1");
      await filedForm(client.id, "2551Q", "2026-Q2");
      await filedForm(client.id, "0619E", "2026-01");
      await invoice(client.id, "Sent");
      await invoice(client.id, "Sent");
      await refuses(
        client.id,
        [
          one("filedBirReturns", 3, "3 filed BIR returns"),
          one("sentInvoices", 2, "2 sent invoices"),
        ],
        "This client cannot be deleted: it has 3 filed BIR returns and 2 sent invoices. Archive it instead.",
      );
    });

    it("three kinds: a list with commas and a final and", async () => {
      const c = await newClient();
      await filedForm(c.id);
      await invoice(c.id, "Paid");
      await newClient({ billingParentId: c.id });
      const res = await del(c.id, { confirmName: REG_NAME });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(
        "This client cannot be deleted: it has 1 filed BIR return, 1 sent invoice and 1 sub-client billed under it. Archive it instead.",
      );
    });
  });

  describe("X3 · all or nothing", () => {
    it("a delete that fails half way leaves everything, files included", async () => {
      const { client, fs, files } = await fullClient();
      // Another client's expense in this client's category: the category cannot go.
      const other = await newClient();
      const cat = await db.category.findFirstOrThrow({
        where: { clientId: client.id, type: "EXPENSE" },
      });
      await db.purchaseTransaction.create({
        data: {
          clientId: other.id,
          categoryId: cat.id,
          txnDate: new Date("2026-08-01"),
          description: "cross",
          netAmount: "1.00",
        },
      });
      const before = await rowsOf(client.id);
      const res = await del(client.id, { confirmName: REG_NAME });
      expect(res.status).toBe(500);
      expect(await rowsOf(client.id)).toEqual(before);
      expect(
        (await db.fsReport.findUniqueOrThrow({ where: { id: fs.id } })).clientId,
      ).toBe(client.id);
      for (const key of files)
        expect([key, storage.objects.has(key)]).toEqual([key, true]);
      expect(
        await db.auditLog.count({
          where: { action: "client.deleted", entityId: client.id },
        }),
      ).toBe(0);
    });
  });

  describe("X4 · another firm's client", () => {
    it("is a 404 on both routes, and stays", async () => {
      const other = await db.firm.create({ data: { name: `${TAG} Other Firm` } });
      const foreign = await newClient({}, other.id);
      const c = await check(foreign.id);
      expect([c.status, c.body.message]).toEqual([404, "Client not found"]);
      const d = await del(foreign.id, { confirmName: REG_NAME });
      expect([d.status, d.body.message]).toEqual([404, "Client not found"]);
      expect(await db.client.count({ where: { id: foreign.id } })).toBe(1);
    });
  });

  describe("X5 · permission", () => {
    it.each(["Manager", "Accountant", "Staff", "Auditor"])(
      "%s cannot check or delete (403), even when assigned to the client",
      async (who) => {
        const c = await newClient();
        await db.firmClientAssignment.create({
          data: { firmUserId: users[who]!, clientId: c.id },
        });
        expect((await check(c.id, who)).status).toBe(403);
        expect((await del(c.id, { confirmName: REG_NAME }, who)).status).toBe(403);
        expect(await db.client.count({ where: { id: c.id } })).toBe(1);
      },
    );

    it("a client user cannot, not even on its own client (403)", async () => {
      const { client, clientUser } = await fullClient();
      tokens.client = app.get(TokenService).signAccess({
        id: clientUser.id,
        firmId,
        userType: "CLIENT",
        email: clientUser.email,
        clientId: client.id,
      } as Parameters<TokenService["signAccess"]>[0]);
      expect((await check(client.id, "client")).status).toBe(403);
      expect((await del(client.id, { confirmName: REG_NAME }, "client")).status).toBe(
        403,
      );
      expect(await db.client.count({ where: { id: client.id } })).toBe(1);
    });

    it("the seed's Super Admin holds Clients:Delete, and no other default role does", async () => {
      const holders = await db.role.findMany({
        where: {
          scope: "FIRM",
          name: { in: ROLES },
          rolePermissions: {
            some: { permission: { resource: "Clients", action: "Delete" } },
          },
        },
        select: { name: true },
      });
      expect(holders.map((r) => r.name)).toEqual(["Super Admin"]);
    });
  });

  describe("X6 · confirmName", () => {
    it.each([
      ["a different name", { confirmName: "HALIMBAWA TRADING" }],
      ["an empty name", { confirmName: "" }],
      ["no name at all", {}],
      ["no body", undefined],
    ])("%s is 400 with the one sentence, and nothing goes", async (_label, body) => {
      const c = await newClient();
      const res = await del(c.id, body);
      expect([res.status, res.body.message]).toEqual([400, TYPE_NAME]);
      expect(await db.client.count({ where: { id: c.id } })).toBe(1);
    });

    it("case and spaces are folded", async () => {
      const c = await newClient();
      const res = await del(c.id, { confirmName: "  halimbawa   Trading\tcorp " });
      expect(res.status).toBe(200);
      expect(await db.client.count({ where: { id: c.id } })).toBe(0);
    });

    it("the name is asked before the blockers are told", async () => {
      const c = await newClient();
      await newClient({ billingParentId: c.id });
      const res = await del(c.id, { confirmName: "wrong" });
      expect([res.status, res.body.message]).toEqual([400, TYPE_NAME]);
    });
  });

  describe("X7 · the audit event", () => {
    it("client.deleted: who, the registered name and TIN, the counts; never the records", async () => {
      const { client } = await fullClient();
      expect((await del(client.id, { confirmName: REG_NAME })).status).toBe(200);
      const rows = await db.auditLog.findMany({
        where: { action: "client.deleted", entityId: client.id },
      });
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect([row!.userId, row!.entityType]).toEqual([users["Super Admin"], "Client"]);
      expect(row!.metadata).toEqual({
        registeredName: REG_NAME,
        tin: TIN,
        deleted: Object.fromEntries(WILL_DELETE.map((w) => [w.kind, w.count])),
        unlinked: { fsReports: 1 },
      });
    });
  });

  describe("X8 · a stored file that fails to delete", () => {
    it("is listed in the answer, and the delete stands", async () => {
      const { client, files } = await fullClient();
      const [cor, , scan0] = files;
      storage.failing.add(cor!);
      storage.failing.add(scan0!);
      const res = await del(client.id, { confirmName: REG_NAME });
      expect(res.status).toBe(200);
      expect(res.body.filesNotRemoved).toEqual([{ key: cor }, { key: scan0 }]);
      expect(await db.client.count({ where: { id: client.id } })).toBe(0);
      for (const key of files) {
        expect([key, storage.objects.has(key)]).toEqual([
          key,
          key === cor || key === scan0,
        ]);
      }
      storage.failing.clear();
    });
  });
});
