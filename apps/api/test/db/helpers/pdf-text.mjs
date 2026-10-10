// pdf-text.mjs — prints a PDF's text layer as JSON, one item per glyph run:
// [{ page, str, x, y }]. Run in its own Node process by pdf-text.ts, because
// pdfjs-dist is ES-module only and Jest runs the API's tests as CommonJS.
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const out = [];
for (const path of process.argv.slice(2)) {
  const task = getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 });
  const doc = await task.promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await (await doc.getPage(p)).getTextContent();
    for (const it of page.items) {
      if (!("str" in it) || it.str.trim() === "") continue;
      items.push({ page: p, str: it.str, x: it.transform[4], y: it.transform[5] });
    }
  }
  out.push({ pages: doc.numPages, items });
  await task.destroy();
}
process.stdout.write(JSON.stringify(out));
