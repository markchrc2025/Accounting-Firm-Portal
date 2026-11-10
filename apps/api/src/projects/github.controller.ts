// github.controller.ts — PA4 (D68): POST /api/v1/projects/github/webhook. No session and no token:
// GitHub proves itself with X-Hub-Signature-256, an HMAC of the exact bytes it sent, made with the
// shared secret in GITHUB_WEBHOOK_SECRET (one secret for the Portal). A missing, wrong or
// unconfigured signature is a plain 401 and nothing is read or written. ping answers 200,
// pull_request and push are handled, any other event is a 202 and ignored.
import { Controller, Post, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { verifyGithubSignature } from "@portal/projects-core";
import type { Request, Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { WEBHOOK_BAD_JSON, type RequestWithRaw } from "../projects-mcp/body-limit";
import { GithubService } from "./github.service";

@ApiExcludeController() // GitHub's, not a screen's: keep it out of the public Swagger doc
@Public()
@Controller("projects/github/webhook")
export class ProjectsGithubController {
  constructor(private readonly github: GithubService) {}

  @Post()
  async receive(@Req() req: Request, @Res() res: Response): Promise<void> {
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? "";
    const raw = (req as RequestWithRaw).rawBody;
    if (!raw || !verifyGithubSignature(raw, req.headers["x-hub-signature-256"], secret)) {
      res.status(401).json({ statusCode: 401, message: "Unauthorized" });
      return;
    }
    const header = req.headers["x-github-event"];
    const event = String(Array.isArray(header) ? header[0] : (header ?? ""));
    if (event === "ping") {
      res.status(200).json({ ok: true, pong: true });
      return;
    }
    if (event !== "pull_request" && event !== "push") {
      res.status(202).json({ ok: true, ignored: event });
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      res.status(400).json({ statusCode: 400, message: WEBHOOK_BAD_JSON });
      return;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      res.status(400).json({ statusCode: 400, message: WEBHOOK_BAD_JSON });
      return;
    }
    res
      .status(200)
      .json(await this.github.handle(event, payload as Record<string, never>));
  }
}
