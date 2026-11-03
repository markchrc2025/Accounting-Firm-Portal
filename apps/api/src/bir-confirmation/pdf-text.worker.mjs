// pdf-text.worker.mjs — U18: prints the text layer of the PDF on stdin, one line of text
// per line of the page, as JSON { pages, text }. Run by pdf-text.ts in its OWN Node
// process with a timeout and a memory cap, because (1) pdfjs-dist is ES-module only and
// the API runs as CommonJS, and (2) an upload is untrusted: a PDF that hangs or exhausts
// memory must take down this process, not the API. Nothing is logged: the text is the
// e-mail's, and it goes to stdout only.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_PAGES = 20;
const LINE_TOLERANCE = 2.5; // points: runs this close in y are one line

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const data = new Uint8Array(Buffer.concat(chunks));

const task = getDocument({
  data,
  verbosity: 0,
  isEvalSupported: false,
  useSystemFonts: false,
  disableFontFace: true,
  stopAtErrors: false,
});
const doc = await task.promise;
const lines = [];
for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
  const content = await (await doc.getPage(p)).getTextContent();
  const runs = content.items
    .filter((it) => "str" in it && it.str.trim() !== "")
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  let current = null;
  for (const r of runs) {
    if (current && Math.abs(current.y - r.y) <= LINE_TOLERANCE) {
      current.runs.push(r);
    } else {
      current = { y: r.y, runs: [r] };
      lines.push(current);
    }
  }
}
const text = lines
  .map((l) =>
    l.runs
      .sort((a, b) => a.x - b.x)
      .map((r) => r.str.trim())
      .join(" "),
  )
  .join("\n");
process.stdout.write(JSON.stringify({ pages: doc.numPages, text }));
await task.destroy();
