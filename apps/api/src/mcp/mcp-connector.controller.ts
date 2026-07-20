import { Controller, Get, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { McpService } from "./mcp.service";

/**
 * Super-Admin management of the Claude (MCP) connector link. Guarded by the
 * `IntegrationClient:*` permissions, which only the Super Admin role holds —
 * same access as the Integration Credentials page. The secret IS the
 * capability: anyone holding the full URL can read and write portal data, so
 * viewing it is deliberate (share it to grant access, rotate it to revoke).
 */
@ApiTags("integrations")
@Controller("mcp-connector")
export class McpConnectorController {
  constructor(private readonly mcp: McpService) {}

  @Get()
  @RequirePermissions("IntegrationClient:Read")
  get() {
    return this.mcp.getConnector();
  }

  /** Mint a new secret — the previous link dies immediately. */
  @Post("rotate")
  @RequirePermissions("IntegrationClient:Update")
  rotate(@CurrentUser() user: AuthUser) {
    return this.mcp.rotateConnector(user);
  }

  /** Switch the connector off entirely (rotate to re-enable). */
  @Post("disable")
  @RequirePermissions("IntegrationClient:Update")
  disable(@CurrentUser() user: AuthUser) {
    return this.mcp.disableConnector(user);
  }
}
