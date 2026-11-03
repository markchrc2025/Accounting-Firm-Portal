// certificate-print.ts — hermetic stand-ins for the three server calls a 2307's print
// buttons make (C7, D56):
//
//   "Preview PDF"          POST /bir-forms/:id/preview-pdf          → the PDF, an attachment
//   "Download clear copy"  POST /bir-forms/:id/clear-copy           → the export row
//                          GET  /bir-forms/:id/exports/:eid/url     → a signed link
//                          GET  <signed link>                       → the PDF, an attachment
//
// Register after a spec's own catch-all router: the last route registered answers first.
// All data is invented.
import type { Page } from "@playwright/test";

export const SIGNED_HOST = "https://signed.example.test";
export const EXPORT_ID = "e2307000-0000-4000-8000-0000000000e1";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

export interface PrintCalls {
  previews: number;
  clearCopies: number;
}

export async function mockCertificatePrint(
  page: Page,
  id: string,
  names: { preview: string; clear: string },
  opts: { previewRefusal?: string } = {},
): Promise<PrintCalls> {
  const calls: PrintCalls = { previews: 0, clearCopies: 0 };
  await page.route(`**/api/v1/bir-forms/${id}/preview-pdf`, (route) => {
    calls.previews += 1;
    if (opts.previewRefusal) {
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ statusCode: 409, message: opts.previewRefusal }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: {
        "Content-Disposition": `attachment; filename="${names.preview}"`,
        "Access-Control-Expose-Headers": "Content-Disposition,X-Export-Warnings",
      },
      body: PDF,
    });
  });
  await page.route(`**/api/v1/bir-forms/${id}/clear-copy`, (route) => {
    calls.clearCopies += 1;
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: EXPORT_ID,
        kind: "pdf",
        filename: names.clear,
        createdAt: "2026-10-22T03:00:00.000Z",
      }),
    });
  });
  await page.route(`**/api/v1/bir-forms/${id}/exports/${EXPORT_ID}/url`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: `${SIGNED_HOST}/${names.clear}?sig=invented` }),
    }),
  );
  await page.route(`${SIGNED_HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "Content-Disposition": `attachment; filename="${names.clear}"` },
      body: PDF,
    }),
  );
  return calls;
}
