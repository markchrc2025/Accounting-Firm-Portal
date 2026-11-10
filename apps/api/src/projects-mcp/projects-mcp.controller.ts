// projects-mcp.controller.ts — PA3 (D67): the Projects MCP endpoint, over HTTP, stateless, JSON
// responses (no streaming).
//
//   POST /api/v1/projects/mcp            Authorization: Bearer <personal token>   (Claude Code)
//   POST /api/v1/projects/mcp/<token>    the token in the URL: a capability URL    (claude.ai)
//
// Separate from the BIR connector at /api/v1/mcp/<key>. The routes are @Public() for the Portal's
// sign-in guard because they carry their own: the token. A wrong token on the Bearer door is a
// 401 with a sentence; on the capability URL it is a plain 404 with no detail, as if the route did
// not exist. Each token may call 240 times a minute (shared through Redis); the body is at most 1 MB.
import { Controller, Delete, Get, Param, Post, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import {
  ApiTokensService,
  TOKEN_INVALID,
  type ApiTokenPrincipal,
} from "../api-tokens/api-tokens.service";
import { parseBearer } from "../api-tokens/token-format";
import { Public } from "../common/decorators/public.decorator";
import { McpRateLimitService } from "./mcp-rate-limit.service";
import { ProjectsMcpService } from "./projects-mcp.service";

const rpcError = (res: Response, status: number, message: string) =>
  res.status(status).json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });
const plain404 = (res: Response) =>
  res.status(404).json({ statusCode: 404, message: "Not Found" });

@ApiExcludeController() // the capability URL is a secret: keep it out of the public Swagger doc
@Public()
@Controller("projects/mcp")
export class ProjectsMcpController {
  constructor(
    private readonly tokens: ApiTokensService,
    private readonly limits: McpRateLimitService,
    private readonly mcp: ProjectsMcpService,
  ) {}

  @Post()
  async viaBearer(@Req() req: Request, @Res() res: Response): Promise<void> {
    const token = parseBearer(req.headers.authorization);
    if (!token) {
      rpcError(
        res,
        401,
        "Missing token. Send Authorization: Bearer ppt_... or use /api/v1/projects/mcp/<token>.",
      );
      return;
    }
    const principal = await this.tokens.authenticate(token);
    if (!principal) {
      rpcError(res, 401, TOKEN_INVALID);
      return;
    }
    const header = req.headers["x-portal-client"];
    const named = (Array.isArray(header) ? header[0] : header)?.trim();
    await this.serve(req, res, principal, named ? named.slice(0, 40) : "claude-code");
  }

  @Post(":token")
  async viaUrl(
    @Param("token") token: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const principal = await this.tokens.authenticate(token);
    if (!principal) {
      plain404(res);
      return;
    }
    await this.serve(req, res, principal, "claude.ai");
  }

  @Get()
  getBearer(@Res() res: Response): void {
    this.methodNotAllowed(res);
  }

  @Delete()
  deleteBearer(@Res() res: Response): void {
    this.methodNotAllowed(res);
  }

  @Get(":token")
  async getUrl(@Param("token") token: string, @Res() res: Response): Promise<void> {
    await this.urlNotAllowed(token, res);
  }

  @Delete(":token")
  async deleteUrl(@Param("token") token: string, @Res() res: Response): Promise<void> {
    await this.urlNotAllowed(token, res);
  }

  private async urlNotAllowed(token: string, res: Response): Promise<void> {
    if (!(await this.tokens.authenticate(token))) {
      plain404(res);
      return;
    }
    this.methodNotAllowed(res);
  }

  private methodNotAllowed(res: Response): void {
    res.setHeader("Allow", "POST");
    rpcError(res, 405, "Method Not Allowed: this MCP server is stateless (POST only).");
  }

  private async serve(
    req: Request,
    res: Response,
    principal: ApiTokenPrincipal,
    client: string,
  ): Promise<void> {
    const rate = await this.limits.hit(principal.tokenId);
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      rpcError(res, 429, "Too many requests, slow down.");
      return;
    }
    const scope = await this.tokens.effectiveScope(principal);
    const server = this.mcp.build({
      user: principal.user,
      tokenId: principal.tokenId,
      client,
      scope,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    // The body was already read by the JSON parser (1 MB for this path); hand it to the SDK.
    await transport.handleRequest(req, res, req.body);
  }
}
