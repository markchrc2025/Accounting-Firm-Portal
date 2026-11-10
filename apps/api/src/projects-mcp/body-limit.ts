// body-limit.ts — PA3 (D67): the Projects MCP endpoint reads a body of up to 1 MB. Express's own
// default is 100 KB and runs first, so for these two paths the body is read here, before it: call
// applyProjectsMcpBodyLimit before the app starts (main.ts does, and so do tests that build their
// own app).
//
// The body is read by hand, not with a second body-parser, because the tree holds two Express
// majors and parsers of different majors cannot share a request. After a successful read the
// request is marked as parsed (`_body`, the flag body-parser 1.x checks), so Nest's own parser
// leaves it alone.
import type { INestApplication } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

export const MCP_BODY_LIMIT_BYTES = 1_000_000;
export const REQUEST_TOO_LARGE = "Request too large.";

type Parsed = Request & { _body?: boolean };

const reply = (res: Response, status: number, code: number, message: string) =>
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });

export function projectsMcpBodyReader() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== "POST") return next();
    const type = String(req.headers["content-type"] ?? "");
    const encoding = String(req.headers["content-encoding"] ?? "identity").toLowerCase();
    if (!/^application\/json/i.test(type) || encoding !== "identity") return next();
    if (Number(req.headers["content-length"] ?? 0) > MCP_BODY_LIMIT_BYTES) {
      reply(res, 413, -32000, REQUEST_TOO_LARGE);
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    req.on("data", (chunk: Buffer) => {
      if (finished) return;
      size += chunk.length;
      if (size > MCP_BODY_LIMIT_BYTES) {
        finished = true;
        reply(res, 413, -32000, REQUEST_TOO_LARGE);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (finished) return;
      finished = true;
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        (req as Parsed).body = text.length ? JSON.parse(text) : {};
        (req as Parsed)._body = true;
        next();
      } catch {
        reply(res, 400, -32700, "Parse error: the body is not valid JSON.");
      }
    });
    req.on("error", () => {
      if (finished) return;
      finished = true;
      reply(res, 400, -32700, "Parse error: the request could not be read.");
    });
  };
}

export function applyProjectsMcpBodyLimit(
  app: INestApplication,
  prefix = "/api/v1",
): void {
  app.use(`${prefix}/projects/mcp`, projectsMcpBodyReader());
}
