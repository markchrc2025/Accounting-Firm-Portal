import { Test } from "@nestjs/testing";
import { OAUTH_SCOPES, VatClass } from "@portal/shared";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: PrismaService, useValue: { ping: async () => true } },
        { provide: RedisService, useValue: { ping: async () => true } },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it("reports liveness and surfaces the @portal/shared contract", () => {
    const info = controller.liveness();
    expect(info.status).toBe("ok");
    // The enums must come straight from @portal/shared, never re-declared.
    expect(info.shared.vatClasses).toEqual(VatClass.options);
    expect(info.shared.integrationScopes).toEqual(OAUTH_SCOPES);
  });

  it("reports readiness ok when dependencies are up", async () => {
    const info = await controller.readiness();
    expect(info.status).toBe("ok");
    expect(info.checks).toEqual({ database: "up", redis: "up" });
  });
});
