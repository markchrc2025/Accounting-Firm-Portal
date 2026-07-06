import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../common/decorators/public.decorator";
import { HealthService, LivenessInfo, ReadinessInfo } from "./health.service";

@ApiTags("health")
@Public()
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness — always 200 when the process is up. No external dependencies. */
  @Get()
  liveness(): LivenessInfo {
    return this.health.getLiveness();
  }

  /** Readiness — reports DB + Redis connectivity. */
  @Get("readiness")
  readiness(): Promise<ReadinessInfo> {
    return this.health.getReadiness();
  }
}
