// Streamable-HTTP MCP endpoint: POST /api/v1/mcp/<key>
//
// The route is @Public() (the global JwtAuthGuard skips it) and instead gated
// by a capability URL: <key> must match the firm's connector secret in
// constant time. The secret is portal-managed (Firm.settingsJson.mcpSecret,
// rotated by the Super Admin from the Integrations page) with the
// MCP_SHARED_SECRET env var as a pre-portal fallback; 32+ chars required.
// A wrong or missing key — or an unset/weak/disabled secret — returns a
// plain 404, indistinguishable from the route not existing.
//
// Stateless JSON mode: each POST gets a fresh McpServer + transport (no
// sessions to store, safe across multiple container instances). GET/DELETE
// (SSE streams / session teardown) are not supported and answer 405, per the
// Streamable HTTP spec for stateless servers.

import { Controller, Delete, Get, Param, Post, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Public } from "../common/decorators/public.decorator";
import { mcpKeyMatches } from "./mcp-secret";
import { McpService } from "./mcp.service";

@ApiExcludeController() // capability URL — keep it out of the public Swagger doc
@Public()
@Controller("mcp/:key")
export class McpController {
  constructor(private readonly mcp: McpService) {}

  private async authorized(key: string): Promise<boolean> {
    return mcpKeyMatches(key, await this.mcp.resolveSecret());
  }

  @Post()
  async handle(
    @Param("key") key: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!(await this.authorized(key))) {
      res.status(404).json({ statusCode: 404, message: "Not Found" });
      return;
    }
    const server = this.mcp.buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    // Nest's JSON body parser already ran; hand the parsed body to the SDK.
    await transport.handleRequest(req, res, req.body);
  }

  @Get()
  async notAllowedGet(@Param("key") key: string, @Res() res: Response): Promise<void> {
    await this.notAllowed(key, res);
  }

  @Delete()
  async notAllowedDelete(@Param("key") key: string, @Res() res: Response): Promise<void> {
    await this.notAllowed(key, res);
  }

  private async notAllowed(key: string, res: Response): Promise<void> {
    if (!(await this.authorized(key))) {
      res.status(404).json({ statusCode: 404, message: "Not Found" });
      return;
    }
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method Not Allowed — this MCP server is stateless (POST only)." },
      id: null,
    });
  }
}
