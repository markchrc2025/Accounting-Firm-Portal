import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { AuditService } from "./audit.service";
import { AuditQuery, AuditQuerySchema } from "./dto/audit-query.schemas";

/**
 * Firm-facing, read-only audit trail (FR-32). Scoped to the caller's firm;
 * gated by the `AuditLogs:Read` permission (Super Admin, Manager, Auditor).
 */
@ApiTags("audit-logs")
@Controller("audit-logs")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions("AuditLogs:Read")
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(AuditQuerySchema)) query: AuditQuery,
  ) {
    return this.audit.list(user.firmId, query);
  }
}
