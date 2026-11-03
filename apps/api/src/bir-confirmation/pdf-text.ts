// pdf-text.ts — U18: the text of an uploaded PDF, read by pdfjs-dist (Mozilla's PDF.js,
// Apache-2.0) in a separate Node process (pdf-text.worker.mjs). The text is the BIR
// e-mail's — it holds the recipient's name and address — so it is returned to the caller
// and never logged or stored.
import { spawn } from "node:child_process";
import { join } from "node:path";

const WORKER = join(__dirname, "pdf-text.worker.mjs");
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** The bytes could not be read as a PDF (damaged, encrypted, or the reader gave up). */
export class PdfUnreadableError extends Error {
  constructor() {
    super("The PDF could not be read");
    this.name = "PdfUnreadableError";
  }
}

/** The text layer of a PDF, one line of the page per line. Empty for a picture-only PDF. */
export function extractPdfText(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--max-old-space-size=512", WORKER], {
      stdio: ["pipe", "pipe", "ignore"], // stderr is dropped: it could carry text
      windowsHide: true,
    });
    const out: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(new PdfUnreadableError());
    };
    const timer = setTimeout(fail, TIMEOUT_MS);
    child.stdout.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_OUTPUT_BYTES) return fail();
      out.push(c);
    });
    child.on("error", fail);
    child.stdin.on("error", () => undefined); // the child may exit before reading it all
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) return reject(new PdfUnreadableError());
      try {
        const parsed = JSON.parse(Buffer.concat(out).toString("utf8")) as { text?: unknown };
        resolve(typeof parsed.text === "string" ? parsed.text : "");
      } catch {
        reject(new PdfUnreadableError());
      }
    });
    child.stdin.end(Buffer.from(bytes));
  });
}
