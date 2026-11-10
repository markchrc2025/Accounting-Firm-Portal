// body-limit.ts — PA3/PA4 (D67, D68): two Projects endpoints read their body by hand, before
// Express's own 100 KB parser: the MCP endpoint (up to 1 MB), the GitHub webhook (up to 5 MB, and
// the exact bytes are kept, because GitHub signs the bytes), the audit import (up to 5 MB) and the
// Sentire Projects import (up to 25 MB). Call applyProjectsBodyReaders
// before the app starts: main.ts does, and so do tests that build their own app.
//
// The body is read by hand, not with a second body-parser, because the tree holds two Express
// majors and parsers of different majors cannot share a request. After a successful read the
// request is marked as parsed (`_body`, the flag body-parser 1.x checks), so Nest's own parser
// leaves it alone.
import type { INestApplication } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

export const MCP_BODY_LIMIT_BYTES = 1_000_000;
export const WEBHOOK_BODY_LIMIT_BYTES = 5_000_000;
export const REQUEST_TOO_LARGE = "Request too large.";
export const WEBHOOK_BAD_JSON = "The body is not valid JSON.";

export type RequestWithRaw = Request & { _body?: boolean; rawBody?: Buffer };

interface ReaderOptions {
  limit: number;
  /** Keep the bytes as `req.rawBody` (the webhook's signature is over them). */
  keepRaw?: boolean;
  /** What to answer when the body is not JSON. */
  badJson: (res: Response) => void;
  tooLarge: (res: Response) => void;
}

function bodyReader(o: ReaderOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== "POST") return next();
    const type = String(req.headers["content-type"] ?? "");
    const encoding = String(req.headers["content-encoding"] ?? "identity").toLowerCase();
    if (!/^application\/json/i.test(type) || encoding !== "identity") return next();
    if (Number(req.headers["content-length"] ?? 0) > o.limit) {
      o.tooLarge(res);
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    req.on("data", (chunk: Buffer) => {
      if (finished) return;
      size += chunk.length;
      if (size > o.limit) {
        finished = true;
        o.tooLarge(res);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (finished) return;
      finished = true;
      const raw = Buffer.concat(chunks);
      const r = req as RequestWithRaw;
      if (o.keepRaw) r.rawBody = raw;
      if (o.keepRaw) {
        // the handler checks the signature over the bytes first, then reads them as JSON
        r.body = {};
        r._body = true;
        next();
        return;
      }
      try {
        const text = raw.toString("utf8");
        r.body = text.length ? JSON.parse(text) : {};
        r._body = true;
        next();
      } catch {
        o.badJson(res);
      }
    });
    req.on("error", () => {
      if (finished) return;
      finished = true;
      o.badJson(res);
    });
  };
}

const rpc = (res: Response, status: number, code: number, message: string) =>
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });

/** The MCP endpoint's reader (1 MB). */
export function projectsMcpBodyReader() {
  return bodyReader({
    limit: MCP_BODY_LIMIT_BYTES,
    tooLarge: (res) => rpc(res, 413, -32000, REQUEST_TOO_LARGE),
    badJson: (res) => rpc(res, 400, -32700, "Parse error: the body is not valid JSON."),
  });
}

/** The GitHub webhook's reader (5 MB, bytes kept). */
export function githubWebhookBodyReader() {
  return bodyReader({
    limit: WEBHOOK_BODY_LIMIT_BYTES,
    keepRaw: true,
    tooLarge: (res) =>
      res.status(413).json({ statusCode: 413, message: REQUEST_TOO_LARGE }),
    badJson: (res) =>
      res.status(400).json({ statusCode: 400, message: WEBHOOK_BAD_JSON }),
  });
}

/** A findings.json can run to megabytes: the audit import reads up to 5 MB, parsed as usual. */
export function auditsBodyReader() {
  return bodyReader({
    limit: WEBHOOK_BODY_LIMIT_BYTES,
    tooLarge: (res) =>
      res.status(413).json({ statusCode: 413, message: REQUEST_TOO_LARGE }),
    badJson: (res) =>
      res.status(400).json({ statusCode: 400, message: WEBHOOK_BAD_JSON }),
  });
}

/** An export of a whole Sentire Projects database: up to 25 MB, parsed as usual. */
export const IMPORT_BODY_LIMIT_BYTES = 25_000_000;
export function sentireImportBodyReader() {
  return bodyReader({
    limit: IMPORT_BODY_LIMIT_BYTES,
    tooLarge: (res) =>
      res.status(413).json({ statusCode: 413, message: REQUEST_TOO_LARGE }),
    badJson: (res) =>
      res.status(400).json({ statusCode: 400, message: WEBHOOK_BAD_JSON }),
  });
}

export function applyProjectsBodyReaders(
  app: INestApplication,
  prefix = "/api/v1",
): void {
  app.use(`${prefix}/projects/mcp`, projectsMcpBodyReader());
  app.use(`${prefix}/projects/:key/audits`, auditsBodyReader());
  app.use(`${prefix}/projects/github/webhook`, githubWebhookBodyReader());
  app.use(`${prefix}/projects/import/sentire`, sentireImportBodyReader());
}

/** PA3's name for it, kept so nothing that called it breaks. */
export const applyProjectsMcpBodyLimit = applyProjectsBodyReaders;
