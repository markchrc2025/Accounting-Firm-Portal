// Streamable-HTTP MCP endpoint: POST /api/v1/mcp/<key>
//
// The route is @Public() (the global JwtAuthGuard skips it) and instead gated
// by a capability URL: <key> must match MCP_SHARED_SECRET (Sliplane env var,
// 32+ chars) in constant time. A wrong or missing key — or an unset/weak
// secret — returns a plain 404, indistinguishable from the route not existing.
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

  private authorized(key: string): boolean {
    return mcpKeyMatches(key, process.env.MCP_SHARED_SECRET);
  }

  @Post()
  async handle(
    @Param("key") key: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.authorized(key)) {
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
  notAllowedGet(@Param("key") key: string, @Res() res: Response): void {
    this.notAllowed(key, res);
  }

  @Delete()
  notAllowedDelete(@Param("key") key: string, @Res() res: Response): void {
    this.notAllowed(key, res);
  }

  private notAllowed(key: string, res: Response): void {
    if (!this.authorized(key)) {
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
