import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { OAUTH_SCOPES } from "@portal/shared";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Boots the full Nest app (no live DB/Redis required — PrismaService tolerates a
 * missing database at startup) and hits the liveness endpoint through HTTP.
 */
describe("Health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/v1/health returns ok with the shared contract", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.shared.integrationScopes).toEqual(OAUTH_SCOPES);
  });
});
