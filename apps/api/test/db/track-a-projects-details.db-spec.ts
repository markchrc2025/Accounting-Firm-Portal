/**
 * track-a-projects-details.db-spec.ts — PA8 (D70): a project is a firm engagement. Client (a listed
 * client or any text), the professional fee, and the category list, over HTTP against the real Nest
 * app and the local PostgreSQL. Every firm, user and client is invented.
 *
 * D1  Client: free text, a listed client, visibility only when linked, client-matches, Link.
 * D2  Professional fee: what is accepted, what is refused, the suggestion that is never saved.
 * D3  Categories: seeded, edited, in use, on a project, filtered.
 */
import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { truncateOncePerFile } from "./helpers/truncate";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { PrismaService } from "../../src/prisma/prisma.service";

truncateOncePerFile({ firmRoles: ["Super Admin"] });

const TAG = `track-a-det-${randomUUID().slice(0, 8)}`;
const API = "/api/v1";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tests read JSON
type Json = Record<string, any>;
const missing = (...p: string[]) => `Missing permission(s): ${p.join(", ")}`;
const FEE_SENTENCE =
  "The professional fee must be a number, zero or more, with at most 2 decimals.";

describe("PA8 · project details for a firm: client, fee, category (real app over HTTP, db)", () => {
  let app: INestApplication;
  let db: PrismaService;
  let firmId = "";
  let otherFirmId = "";
  let clientA = ""; // visible to memberAssigned only; fee 3500
  let clientB = ""; // no fee; trade name differs
  let clientOther = ""; // another firm
  const jwt: Record<string, string> = {};
  let seq = 0;

  const http = () => request(app.getHttpServer());
  const as = (
    method: "get" | "post" | "patch" | "delete",
    path: string,
    who = "sa",
    body?: object,
  ) => {
    const r = http()[method](`${API}${path}`).set("Authorization", `Bearer ${jwt[who]}`);
    return body === undefined ? r : r.send(body);
  };
  async function project(extra: Json = {}, who = "sa") {
    seq += 1;
    const key = extra.key ?? `D${String(seq).padStart(3, "0")}`;
    const res = await as("post", "/projects", who, {
      name: `Engagement ${key}`,
      ...extra,
      key,
    });
    return { key: key as string, res };
  }
  async function makeRole(name: string, perms: string[]) {
    const role = await db.role.create({ data: { name, scope: "FIRM", isSystem: false } });
    for (const p of perms) {
      const [resource, action] = p.split(":") as [string, string];
      const permission = await db.permission.upsert({
        where: { resource_action: { resource, action } },
        update: {},
        create: { resource, action },
      });
      await db.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
    return role.id;
  }
  async function makeUser(
    label: string,
    roleId?: string,
    firm?: string,
    assign?: string[],
  ) {
    const fid = firm ?? firmId;
    const u = await db.user.create({
      data: {
        firmId: fid,
        userType: "FIRM",
        fullName: `${TAG} ${label}`,
        email: `${TAG}-${label}@example.com`,
        status: "ACTIVE",
        firmProfile: {
          create: {
            title: "Test",
            ...(assign?.length
              ? { clientAssignments: { create: assign.map((c) => ({ clientId: c })) } }
              : {}),
          },
        },
        ...(roleId ? { userRoles: { create: { roleId } } } : {}),
      },
    });
    jwt[label] = app
      .get(TokenService)
      .signAccess({ id: u.id, firmId: fid, userType: "FIRM", email: u.email });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    db = app.get(PrismaService);
    firmId = (await db.firm.create({ data: { name: `${TAG} Halimbawa Accounting` } })).id;
    otherFirmId = (await db.firm.create({ data: { name: `${TAG} Ibang Accounting` } }))
      .id;
    const sa = (
      await db.role.findUniqueOrThrow({
        where: { name_scope: { name: "Super Admin", scope: "FIRM" } },
      })
    ).id;
    const member = await makeRole(`${TAG} DET Member`, [
      "Projects:Read",
      "Projects:Create",
      "Projects:Update",
    ]);
    const viewer = await makeRole(`${TAG} DET Viewer`, ["Projects:Read"]);
    clientA = (
      await db.client.create({
        data: {
          firmId,
          businessName: `${TAG} Dela Cruz Bookkeeping`,
          tin: "000777001",
          professionalFee: "3500.00",
        },
      })
    ).id;
    clientB = (
      await db.client.create({
        data: {
          firmId,
          businessName: `${TAG} Santos Holdings`,
          tradeName: `${TAG} Santos Sari-Sari`,
          tin: "000777002",
        },
      })
    ).id;
    clientOther = (
      await db.client.create({
        data: {
          firmId: otherFirmId,
          businessName: `${TAG} Dela Cruz Bookkeeping`,
          tin: "000777003",
        },
      })
    ).id;
    await makeUser("sa", sa);
    await makeUser("sa2", sa, otherFirmId);
    await makeUser("member", member); // sees no client
    await makeUser("memberAssigned", member, undefined, [clientA]);
    await makeUser("viewer", viewer);
    await makeUser("norole");
  });
  afterAll(async () => {
    await app.close();
  });

  // ======================================================================================
  describe("D1 · client: any text, or a listed client", () => {
    it("a typed name that is not listed sets clientName only; the project is visible to anyone with Projects:Read", async () => {
      const { key, res } = await project({ clientName: "  Walang Listahan Trading  " });
      expect(res.status).toBe(201);
      expect(res.body.clientName).toBe("Walang Listahan Trading");
      expect(res.body.client).toBeNull();
      for (const who of ["member", "viewer", "memberAssigned"]) {
        const got = await as("get", `/projects/${key}`, who);
        expect(got.status).toBe(200);
        expect(got.body.project.clientName).toBe("Walang Listahan Trading");
        expect(got.body.project.client).toBeNull();
      }
      expect(
        (await db.project.findFirstOrThrow({ where: { firmId, key } })).clientId,
      ).toBeNull();
    });

    it("a listed client sets clientId and copies its name into clientName", async () => {
      const { res } = await project({ clientId: clientA });
      expect(res.status).toBe(201);
      expect(res.body.client).toEqual({
        id: clientA,
        businessName: `${TAG} Dela Cruz Bookkeeping`,
      });
      expect(res.body.clientName).toBe(`${TAG} Dela Cruz Bookkeeping`);
    });

    it("a listed client wins over a typed name sent with it", async () => {
      const { res } = await project({ clientId: clientA, clientName: "Something else" });
      expect(res.status).toBe(201);
      expect(res.body.clientName).toBe(`${TAG} Dela Cruz Bookkeeping`);
    });

    it("the client rule applies only when clientId is set", async () => {
      const linked = await project({ clientId: clientA });
      expect(linked.res.status).toBe(201);
      const free = await project({ clientName: `${TAG} Dela Cruz Bookkeeping` }); // same words, not linked
      // a person who cannot see the client does not see the linked project, nor find it in the portfolio
      expect((await as("get", `/projects/${linked.key}`, "member")).status).toBe(404);
      expect((await as("get", `/projects/${linked.key}`, "memberAssigned")).status).toBe(
        200,
      );
      const list = (await as("get", "/projects", "member")).body as Json[];
      expect(list.map((p) => p.key)).not.toContain(linked.key);
      expect(list.map((p) => p.key)).toContain(free.key);
      const listAssigned = (await as("get", "/projects", "memberAssigned"))
        .body as Json[];
      expect(listAssigned.map((p) => p.key)).toContain(linked.key);
    });

    it("a person cannot link a client they cannot see, nor another firm's", async () => {
      const a = await project({ clientId: clientA }, "member");
      expect(a.res.status).toBe(404);
      expect(a.res.body.message).toBe("Client not found.");
      const o = await project({ clientId: clientOther });
      expect(o.res.status).toBe(404);
    });

    it("typing another name on a linked project unlinks it and keeps the text", async () => {
      const { key } = await project({ clientId: clientA });
      const res = await as("patch", `/projects/${key}`, "sa", {
        clientName: "A brand new client",
      });
      expect(res.status).toBe(200);
      expect(res.body.client).toBeNull();
      expect(res.body.clientName).toBe("A brand new client");
      expect((await as("get", `/projects/${key}`, "member")).status).toBe(200); // no longer hidden
    });

    it("clientId null unlinks and keeps the typed name; an empty name clears it", async () => {
      const { key } = await project({ clientId: clientA });
      const un = await as("patch", `/projects/${key}`, "sa", { clientId: null });
      expect(un.body.client).toBeNull();
      expect(un.body.clientName).toBe(`${TAG} Dela Cruz Bookkeeping`);
      const clear = await as("patch", `/projects/${key}`, "sa", { clientName: "   " });
      expect(clear.status).toBe(200);
      expect(clear.body.clientName).toBeNull();
      expect(clear.body.client).toBeNull();
    });

    it("the same name sent again changes nothing", async () => {
      const { key } = await project({ clientId: clientA });
      const res = await as("patch", `/projects/${key}`, "sa", {
        clientName: `${TAG} Dela Cruz Bookkeeping`,
      });
      expect(res.status).toBe(200);
      expect(res.body.client).toEqual({
        id: clientA,
        businessName: `${TAG} Dela Cruz Bookkeeping`,
      });
    });

    it("200 characters are kept, 201 are refused", async () => {
      const ok = await project({ clientName: "n".repeat(200) });
      expect(ok.res.status).toBe(201);
      expect(ok.res.body.clientName).toHaveLength(200);
      const bad = await project({ clientName: "n".repeat(201) });
      expect(bad.res.status).toBe(400);
    });

    it("PATCH clientId links, copying the name; the portfolio and the overview carry both", async () => {
      const { key } = await project({ clientName: "Dela Cruz Bookkeeping" });
      const link = await as("patch", `/projects/${key}`, "sa", { clientId: clientA });
      expect(link.status).toBe(200);
      expect(link.body.client.id).toBe(clientA);
      expect(link.body.clientName).toBe(`${TAG} Dela Cruz Bookkeeping`);
      const row = ((await as("get", "/projects", "sa")).body as Json[]).find(
        (p) => p.key === key,
      )!;
      expect(row.client.id).toBe(clientA);
      expect(row.clientName).toBe(`${TAG} Dela Cruz Bookkeeping`);
      const ov = (await as("get", `/projects/${key}`, "sa")).body.project;
      expect(ov.client.id).toBe(clientA);
      expect(ov.clientName).toBe(`${TAG} Dela Cruz Bookkeeping`);
    });

    it("the change is on the activity log", async () => {
      const { key } = await project({ clientName: "First" });
      await as("patch", `/projects/${key}`, "sa", { clientName: "Second" });
      const feed = (await as("get", `/projects/${key}/activity`, "sa")).body
        .items as Json[];
      const upd = feed.find((a) => a.action === "project.updated")!;
      expect(upd.changes).toContainEqual({
        field: "clientName",
        old: "First",
        new: "Second",
      });
    });
  });

  // ======================================================================================
  describe("D1b · GET /projects/:key/client-matches", () => {
    it("lists the listed clients whose name equals clientName after folding case, punctuation and spaces; it never links", async () => {
      const { key } = await project({
        clientName: `  ${TAG.toUpperCase()}  dela-cruz, bookkeeping. `,
      });
      const res = await as("get", `/projects/${key}/client-matches`, "sa");
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(["clientName", "linked", "matches"]);
      expect(res.body.linked).toBe(false);
      expect(res.body.matches).toEqual([
        { id: clientA, businessName: `${TAG} Dela Cruz Bookkeeping`, status: "ACTIVE" },
      ]);
      expect(
        (await db.project.findFirstOrThrow({ where: { firmId, key } })).clientId,
      ).toBeNull();
    });

    it("also matches a trade name; another firm's client never appears", async () => {
      const { key } = await project({ clientName: `${TAG} Santos Sari-Sari` });
      const res = await as("get", `/projects/${key}/client-matches`, "sa");
      expect(res.body.matches.map((m: Json) => m.id)).toEqual([clientB]);
      const dup = await project({ clientName: `${TAG} Dela Cruz Bookkeeping` });
      const m = (await as("get", `/projects/${dup.key}/client-matches`, "sa")).body
        .matches as Json[];
      expect(m.map((x) => x.id)).toEqual([clientA]);
      expect(m.map((x) => x.id)).not.toContain(clientOther);
    });

    it("only clients the caller can see are listed", async () => {
      const { key } = await project({ clientName: `${TAG} Dela Cruz Bookkeeping` });
      expect(
        (await as("get", `/projects/${key}/client-matches`, "member")).body.matches,
      ).toEqual([]);
      const assigned = await as(
        "get",
        `/projects/${key}/client-matches`,
        "memberAssigned",
      );
      expect(assigned.body.matches.map((m: Json) => m.id)).toEqual([clientA]);
    });

    it("no name, no match; a different name, no match; a linked project says linked", async () => {
      const none = await project({});
      expect(
        (await as("get", `/projects/${none.key}/client-matches`, "sa")).body,
      ).toEqual({
        clientName: null,
        linked: false,
        matches: [],
      });
      const other = await project({ clientName: "Nobody Listed" });
      expect(
        (await as("get", `/projects/${other.key}/client-matches`, "sa")).body.matches,
      ).toEqual([]);
      const linked = await project({ clientId: clientA });
      const res = await as("get", `/projects/${linked.key}/client-matches`, "sa");
      expect(res.body.linked).toBe(true);
    });

    it("who may ask: Projects:Read; an unknown project is a 404", async () => {
      const { key } = await project({ clientName: "X" });
      expect((await as("get", `/projects/${key}/client-matches`, "viewer")).status).toBe(
        200,
      );
      const no = await as("get", `/projects/${key}/client-matches`, "norole");
      expect(no.status).toBe(403);
      expect(no.body.message).toBe(missing("Projects:Read"));
      expect((await as("get", "/projects/NOPE/client-matches", "sa")).status).toBe(404);
      expect((await as("get", `/projects/${key}/client-matches`, "sa2")).status).toBe(
        404,
      );
    });
  });

  // ======================================================================================
  describe("D2 · professional fee", () => {
    it.each([
      [12, "12.00"],
      ["12", "12.00"],
      [12.5, "12.50"],
      ["12.50", "12.50"],
      [0, "0.00"],
      ["0.00", "0.00"],
      ["1234567.89", "1234567.89"],
      ["9999999999999999.99", "9999999999999999.99"],
    ])("%p is accepted and kept as %s", async (sent, kept) => {
      const { res, key } = await project({ professionalFee: sent });
      expect(res.status).toBe(201);
      expect(res.body.professionalFee).toBe(kept);
      expect(
        (await as("get", `/projects/${key}`, "sa")).body.project.professionalFee,
      ).toBe(kept);
      expect(
        ((await as("get", "/projects", "sa")).body as Json[]).find((p) => p.key === key)!
          .professionalFee,
      ).toBe(kept);
    });

    it.each([
      12.505,
      "12.505",
      -1,
      "-1",
      "abc",
      "1e3",
      " 12",
      "12 ",
      "1,000",
      "12.",
      ".5",
      true,
      "10000000000000000",
      [12],
      { a: 1 },
    ])("%p is refused with one sentence", async (sent) => {
      const { res } = await project({ professionalFee: sent });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(FEE_SENTENCE);
      const { key } = await project({});
      const patch = await as("patch", `/projects/${key}`, "sa", {
        professionalFee: sent,
      });
      expect(patch.status).toBe(400);
      expect(patch.body.message).toBe(FEE_SENTENCE);
      expect(
        (await db.project.findFirstOrThrow({ where: { firmId, key } })).professionalFee,
      ).toBeNull();
    });

    it("null or an empty string clears it; none at all is null", async () => {
      const { key, res } = await project({ professionalFee: "100" });
      expect(res.body.professionalFee).toBe("100.00");
      expect(
        (await as("patch", `/projects/${key}`, "sa", { professionalFee: null })).body
          .professionalFee,
      ).toBeNull();
      await as("patch", `/projects/${key}`, "sa", { professionalFee: "5" });
      expect(
        (await as("patch", `/projects/${key}`, "sa", { professionalFee: "" })).body
          .professionalFee,
      ).toBeNull();
      expect((await project({})).res.body.professionalFee).toBeNull();
    });

    it("the change is on the activity log", async () => {
      const { key } = await project({ professionalFee: "10" });
      await as("patch", `/projects/${key}`, "sa", { professionalFee: "20.5" });
      const feed = (await as("get", `/projects/${key}/activity`, "sa")).body
        .items as Json[];
      const upd = feed.find((a) => a.action === "project.updated")!;
      expect(upd.changes).toContainEqual({
        field: "professionalFee",
        old: "10.00",
        new: "20.50",
      });
    });

    it("with a listed client and no fee yet the answer suggests the client's fee, and never saves it", async () => {
      const { key, res } = await project({ clientId: clientA });
      expect(res.body.professionalFee).toBeNull();
      expect(res.body.suggestedProfessionalFee).toBe("3500.00");
      expect(
        (await db.project.findFirstOrThrow({ where: { firmId, key } })).professionalFee,
      ).toBeNull();
      const ov = (await as("get", `/projects/${key}`, "sa")).body.project;
      expect(ov.suggestedProfessionalFee).toBe("3500.00");
      const row = ((await as("get", "/projects", "sa")).body as Json[]).find(
        (p) => p.key === key,
      )!;
      expect(row.suggestedProfessionalFee).toBe("3500.00");
    });

    it("no suggestion when the project has a fee, the client has none, or the client is only text", async () => {
      const own = await project({ clientId: clientA, professionalFee: "100" });
      expect(own.res.body.suggestedProfessionalFee).toBeNull();
      const noFee = await project({ clientId: clientB });
      expect(noFee.res.body.suggestedProfessionalFee).toBeNull();
      const text = await project({ clientName: "Dela Cruz Bookkeeping" });
      expect(text.res.body.suggestedProfessionalFee).toBeNull();
    });

    it("picking a client by PATCH suggests the fee but does not save it", async () => {
      const { key } = await project({});
      const res = await as("patch", `/projects/${key}`, "sa", { clientId: clientA });
      expect(res.body.professionalFee).toBeNull();
      expect(res.body.suggestedProfessionalFee).toBe("3500.00");
      expect(
        (await db.project.findFirstOrThrow({ where: { firmId, key } })).professionalFee,
      ).toBeNull();
    });
  });

  // ======================================================================================
  describe("D3 · categories", () => {
    it("every firm has the four starting categories, in order, in the meta list", async () => {
      const meta = (await as("get", "/projects/meta", "viewer")).body as Json;
      expect(meta.projectCategories.map((c: Json) => c.name)).toEqual([
        "Business Registration",
        "Business Closure",
        "Tax Filing",
        "Encoding",
      ]);
      for (const c of meta.projectCategories) {
        expect(Object.keys(c).sort()).toEqual(["colour", "id", "name", "order"]);
        expect(c.colour).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
      const other = (await as("get", "/projects/meta", "sa2")).body as Json;
      expect(other.projectCategories.map((c: Json) => c.id)).not.toContain(
        meta.projectCategories[0].id,
      );
    });

    it("the list is for Projects:Configure; create, update, delete follow the issue type pattern", async () => {
      const denied = await as("get", "/projects/admin/project-categories", "member");
      expect(denied.status).toBe(403);
      expect(denied.body.message).toBe(missing("Projects:Configure"));
      expect(
        (await as("post", "/projects/admin/project-categories", "member", { name: "x" }))
          .status,
      ).toBe(403);

      const made = await as("post", "/projects/admin/project-categories", "sa", {
        name: "Audit Support",
        colour: "#123456",
      });
      expect(made.status).toBe(201);
      expect(made.body).toEqual({
        id: expect.any(String),
        name: "Audit Support",
        colour: "#123456",
        order: 4,
      });
      const dup = await as("post", "/projects/admin/project-categories", "sa", {
        name: "Audit Support",
      });
      expect(dup.status).toBe(409);
      expect(dup.body.message).toBe("That name is already used.");
      expect(
        (await as("post", "/projects/admin/project-categories", "sa", { name: "  " }))
          .status,
      ).toBe(400);
      expect(
        (
          await as("post", "/projects/admin/project-categories", "sa", {
            name: "Bad",
            colour: "red",
          })
        ).status,
      ).toBe(400);

      const list = (await as("get", "/projects/admin/project-categories", "sa"))
        .body as Json[];
      const row = list.find((c) => c.id === made.body.id)!;
      expect(row).toMatchObject({ name: "Audit Support", projectCount: 0 });

      const upd = await as(
        "patch",
        `/projects/admin/project-categories/${made.body.id}`,
        "sa",
        { name: "Audit Support 2", order: 9 },
      );
      expect(upd.status).toBe(200);
      expect(upd.body).toMatchObject({ name: "Audit Support 2", order: 9 });
      expect(
        (
          await as(
            "patch",
            `/projects/admin/project-categories/${made.body.id}`,
            "sa",
            {},
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await as("patch", `/projects/admin/project-categories/${randomUUID()}`, "sa", {
            name: "Z",
          })
        ).status,
      ).toBe(404);

      const del = await as(
        "delete",
        `/projects/admin/project-categories/${made.body.id}`,
        "sa",
      );
      expect(del.status).toBe(200);
      expect(del.body).toEqual({ deleted: true, id: made.body.id });
    });

    it("another firm's category is not found", async () => {
      const mine = (await as("get", "/projects/admin/project-categories", "sa"))
        .body as Json[];
      const theirs = (await as("get", "/projects/admin/project-categories", "sa2"))
        .body as Json[];
      const res = await as(
        "patch",
        `/projects/admin/project-categories/${theirs[0]!.id}`,
        "sa",
        { name: "Hijack" },
      );
      expect(res.status).toBe(404);
      expect(res.body.message).toBe("Category not found.");
      expect(mine.length).toBeGreaterThanOrEqual(4);
    });

    it("a category in use cannot be deleted, and the sentence says how many projects", async () => {
      const cats = (await as("get", "/projects/admin/project-categories", "sa"))
        .body as Json[];
      const tax = cats.find((c) => c.name === "Tax Filing")!;
      const a = await project({ categoryId: tax.id });
      expect(a.res.status).toBe(201);
      const one = await as(
        "delete",
        `/projects/admin/project-categories/${tax.id}`,
        "sa",
      );
      expect(one.status).toBe(409);
      expect(one.body.message).toBe(
        "This category is used by 1 project. Change the category of it first.",
      );
      await project({ categoryId: tax.id });
      const two = await as(
        "delete",
        `/projects/admin/project-categories/${tax.id}`,
        "sa",
      );
      expect(two.body.message).toBe(
        "This category is used by 2 projects. Change the category of them first.",
      );
      expect(await db.projectCategory.count({ where: { id: tax.id } })).toBe(1);
    });

    it("a project takes a category, changes it, clears it; the answers carry { id, name, colour }", async () => {
      const cats = (await as("get", "/projects/admin/project-categories", "sa"))
        .body as Json[];
      const enc = cats.find((c) => c.name === "Encoding")!;
      const reg = cats.find((c) => c.name === "Business Registration")!;
      const { key, res } = await project({ categoryId: enc.id });
      expect(res.body.category).toEqual({
        id: enc.id,
        name: "Encoding",
        colour: enc.colour,
      });
      const moved = await as("patch", `/projects/${key}`, "sa", { categoryId: reg.id });
      expect(moved.body.category.name).toBe("Business Registration");
      expect(
        (await as("get", `/projects/${key}`, "viewer")).body.project.category.id,
      ).toBe(reg.id);
      const cleared = await as("patch", `/projects/${key}`, "sa", { categoryId: null });
      expect(cleared.body.category).toBeNull();
      expect((await project({})).res.body.category).toBeNull();
      const feed = (await as("get", `/projects/${key}/activity`, "sa")).body
        .items as Json[];
      expect(feed.flatMap((a) => a.changes)).toContainEqual({
        field: "category",
        old: "Encoding",
        new: "Business Registration",
      });
    });

    it("an unknown or another firm's category is refused", async () => {
      const theirs = (await as("get", "/projects/admin/project-categories", "sa2"))
        .body as Json[];
      const a = await project({ categoryId: theirs[0]!.id });
      expect(a.res.status).toBe(404);
      expect(a.res.body.message).toBe("Category not found.");
      const b = await project({ categoryId: randomUUID() });
      expect(b.res.status).toBe(404);
    });

    it("the portfolio can be filtered by category, or by none", async () => {
      const cats = (await as("get", "/projects/admin/project-categories", "sa"))
        .body as Json[];
      const closure = cats.find((c) => c.name === "Business Closure")!;
      const withCat = await project({ categoryId: closure.id });
      const without = await project({});
      const by = (await as("get", `/projects?categoryId=${closure.id}`, "sa"))
        .body as Json[];
      expect(by.map((p) => p.key)).toContain(withCat.key);
      expect(by.map((p) => p.key)).not.toContain(without.key);
      expect(by.every((p) => p.category?.id === closure.id)).toBe(true);
      const none = (await as("get", "/projects?categoryId=none", "sa")).body as Json[];
      expect(none.map((p) => p.key)).toContain(without.key);
      expect(none.map((p) => p.key)).not.toContain(withCat.key);
      expect((await as("get", "/projects?categoryId=nope", "sa")).status).toBe(400);
      expect(
        ((await as("get", "/projects", "sa")).body as Json[]).length,
      ).toBeGreaterThan(by.length);
    });
  });
});
