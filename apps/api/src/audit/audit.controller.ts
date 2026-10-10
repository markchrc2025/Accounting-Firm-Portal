import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { CLIENTS_VIEW_ALL } from "../rbac/permissions.constants";
import { AuditService } from "./audit.service";
import { AuditQuery, AuditQuerySchema } from "./dto/audit-query.schemas";

/**
 * Firm-facing, read-only audit trail (FR-32). Scoped to the caller's firm;
 * gated by `AuditLogs:Read` and, since U4-A1 (D42), `Clients:ViewAll`: it records
 * every client's activity, so only a user who sees every client reads it.
 */
@ApiTags("audit-logs")
@Controller("audit-logs")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** U4-A1 (D42): the audit log is a firm record — it needs Clients:ViewAll too. */
  @Get()
  @RequirePermissions("AuditLogs:Read", CLIENTS_VIEW_ALL)
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(AuditQuerySchema)) query: AuditQuery,
  ) {
    return this.audit.list(user.firmId, query);
  }
}
