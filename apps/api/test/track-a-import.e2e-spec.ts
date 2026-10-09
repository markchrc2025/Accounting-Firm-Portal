import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * The HTTP shell of the Expenses import v2 (U6). Hermetic — no database — so
 * what it can prove is the surface: the two routes exist, the template route
 * and the multipart upload are guarded by the bearer-token guard (401, not 404
 * and not 415), and a real multipart body is accepted by the interceptor before
 * the guard answers. The behaviour behind the guard is the db-spec's job.
 */
describe("Expenses import v2 — HTTP surface (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/v1/purchase-transactions/import/template exists and demands a token", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/purchase-transactions/import/template")
      .query({ clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    expect(res.status).toBe(401);
  });

  it("POST /api/v1/purchase-transactions/import accepts a multipart body and demands a token", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/purchase-transactions/import")
      .query({ clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", dryRun: "true" })
      .attach("file", Buffer.from("not really a workbook"), "expenses.xlsx");
    expect(res.status).toBe(401);
  });

  it("POST /api/v1/purchase-transactions/:id/post exists and demands a token", async () => {
    const res = await request(app.getHttpServer()).post(
      "/api/v1/purchase-transactions/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/post",
    );
    expect(res.status).toBe(401);
  });

  it("a route that does not exist still answers 404, so the 401s above are not a blanket", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/purchase-transactions/import/nope");
    expect(res.status).toBe(404);
  });
});
