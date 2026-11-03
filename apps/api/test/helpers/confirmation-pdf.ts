/**
 * confirmation-pdf.ts — builds the BIR confirmation e-mail as a PDF, the way a Gmail
 * "Print → Save as PDF" lays it out, with pdf-lib. Every value in the tests is INVENTED
 * (the TINs, the names, the e-mail addresses); nothing here is, or is copied from, a
 * real confirmation. Used by the hermetic spec and by the db spec (U18).
 */
import { PDFDocument, StandardFonts } from "pdf-lib";

export interface ConfirmationPdfSpec {
  /** "111222333000-2550Qv2024-122026Q1.xml"; null leaves the "File name:" line out. */
  fileName?: string | null;
  /** "25 April 2026"; null leaves the line out. */
  date?: string | null;
  /** "11:40 AM"; null leaves the line out. */
  time?: string | null;
  /** The sender; null leaves it out (and so makes it "not from the BIR"). */
  sender?: string | null;
  /** The title line; null leaves it out. */
  title?: string | null;
  /** The "This confirms receipt…" sentence; null leaves it out. */
  sentence?: string | null;
  /** The sent line's date, e.g. "Sun, 19 Apr 2026, 1:44 am" (shown beside the sender). */
  sentOn?: string;
  /** Draw "File name:" and its value as two separate runs on one line. */
  splitRuns?: boolean;
  /** Wrap the file name over two lines at its first dash. */
  wrapFileName?: boolean;
  /** Append this many bytes after the PDF (to test the size limit). */
  padToBytes?: number;
  /** A page with a drawing and no text at all (a scanned picture). */
  pictureOnly?: boolean;
}

const BIR_SENDER = "ebirforms-noreply@bir.gov.ph";
const SENTENCE =
  "This confirms receipt of your submission with the following details subject to validation by BIR:";

export async function confirmationPdf(spec: ConfirmationPdfSpec = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  if (spec.pictureOnly) {
    page.drawRectangle({ x: 50, y: 500, width: 400, height: 200 });
    page.drawLine({ start: { x: 50, y: 500 }, end: { x: 450, y: 700 } });
    return pad(Buffer.from(await doc.save()), spec.padToBytes);
  }
  let y = 740;
  const line = (text: string) => {
    page.drawText(text, { x: 50, y, size: 11, font });
    y -= 18;
  };
  const pair = (label: string, value: string) => {
    if (spec.splitRuns) {
      page.drawText(label, { x: 50, y, size: 11, font });
      page.drawText(value, { x: 50 + font.widthOfTextAtSize(label + " ", 11), y, size: 11, font });
      y -= 18;
    } else line(`${label} ${value}`);
  };

  line("Invented Recipient <owner@example.test>");
  if (spec.title !== null) line(spec.title ?? "Tax Return Receipt Confirmation");
  if (spec.sender !== null) {
    line(`${spec.sender ?? BIR_SENDER}  ${spec.sentOn ?? "Sat, 25 Apr 2026, 11:41 am"}`);
  }
  line("To: owner@example.test");
  y -= 8;
  if (spec.sentence !== null) line(spec.sentence ?? SENTENCE);
  y -= 8;
  if (spec.fileName !== null) {
    const name = spec.fileName ?? "111222333000-2550Qv2024-122026Q1.xml";
    if (spec.wrapFileName && name.includes("-")) {
      const cut = name.indexOf("-") + 1;
      pair("File name:", name.slice(0, cut));
      line(name.slice(cut));
    } else pair("File name:", name);
  }
  if (spec.date !== null) pair("Date received by BIR:", spec.date ?? "25 April 2026");
  if (spec.time !== null) pair("Time received by BIR:", spec.time ?? "11:40 AM");
  y -= 8;
  line("You may pay through any of the authorized agent banks or the BIR payment channels.");
  line("Bureau of Internal Revenue");
  return pad(Buffer.from(await doc.save()), spec.padToBytes);
}

function pad(pdf: Buffer, to?: number): Buffer {
  if (!to || pdf.length >= to) return pdf;
  return Buffer.concat([pdf, Buffer.alloc(to - pdf.length, 0x20)]);
}

/** Invented TIN used across the tests. */
export const TIN = "111222333";

/** The four VERIFIED shapes (invented TINs). */
export const VERIFIED = {
  "2550Q": "111222333000-2550Qv2024-122026Q1.xml",
  "1701Q": "111222333000-1701Qv2018-2025Q3.xml",
  "1601EQ": "11122233300000-1601EQ-2026Q3.xml",
  "0619E": "11122233300000-0619E-072026.xml",
} as const;
