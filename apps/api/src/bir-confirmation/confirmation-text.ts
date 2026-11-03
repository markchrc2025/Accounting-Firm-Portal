// confirmation-text.ts — U18: what the e-mail's text says. Reads only what the checks
// need — the sender, the title, the sentence, the file name, and the date and time the
// BIR RECEIVED the return (never the sent line). The recipient's name and address in the
// header are not read, kept or returned.
import { BIR_SENDER, BIR_SENTENCE, BIR_TITLE } from "./confirmation-forms";

export interface ConfirmationTextFacts {
  /** The sender, the title and the "This confirms receipt…" sentence are all present. */
  fromBir: boolean;
  fileName: string | null;
  dateText: string | null;
  timeText: string | null;
}

const DATE = /\b(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})\b/;
const TIME = /\b(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?/;

function after(text: string, label: RegExp, span: number): string | null {
  const m = label.exec(text);
  if (!m) return null;
  return text.slice(m.index + m[0].length, m.index + m[0].length + span);
}

export function readConfirmationText(text: string): ConfirmationTextFacts {
  const lower = text.toLowerCase();
  const fromBir =
    lower.includes(BIR_SENDER) &&
    lower.includes(BIR_TITLE.toLowerCase()) &&
    lower.includes(BIR_SENTENCE.toLowerCase());

  // The file name: glue what follows "File name:" and cut at the first ".xml", so a name
  // the print wrapped over two lines still reads.
  let fileName: string | null = null;
  const nameWindow = after(text, /File\s+name\s*:/i, 200);
  if (nameWindow !== null) {
    const glued = nameWindow.replace(/\s+/g, "");
    const m = /^[^\s]*?\.xml/i.exec(glued);
    fileName = m ? m[0] : null;
  }

  const dateWindow = after(text, /Date\s+received\s+by\s+BIR\s*:/i, 60);
  const timeWindow = after(text, /Time\s+received\s+by\s+BIR\s*:/i, 40);
  return {
    fromBir,
    fileName,
    dateText: dateWindow ? (DATE.exec(dateWindow)?.[0] ?? null) : null,
    timeText: timeWindow ? (TIME.exec(timeWindow)?.[0] ?? null) : null,
  };
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function monthNumber(word: string): number | null {
  const w = word.toLowerCase();
  const i = MONTHS.findIndex((m) => m === w || (w.length >= 3 && m.startsWith(w) && w.length <= 4));
  return i === -1 ? null : i + 1;
}

export type Received =
  | {
      ok: true;
      /** The Manila calendar date, "2026-04-25". */
      date: string;
      /** The Manila clock time, 24 hours, "11:40". */
      time: string;
      /** That moment as an instant. */
      at: Date;
    }
  | { ok: false };

/** "25 April 2026" + "11:40 AM" (Manila time, UTC+8, no daylight saving) → an instant. */
export function parseReceived(dateText: string, timeText: string): Received {
  const d = DATE.exec(dateText ?? "");
  const t = TIME.exec(timeText ?? "");
  if (!d || !t) return { ok: false };
  const month = monthNumber(d[2]!);
  const day = Number(d[1]);
  const year = Number(d[3]);
  let hour = Number(t[1]);
  const minute = Number(t[2]);
  if (month === null || hour < 1 || hour > 12 || minute > 59) return { ok: false };
  const pm = t[3]!.toLowerCase() === "p";
  hour = (hour % 12) + (pm ? 12 : 0); // 12 AM → 0, 12 PM → 12
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return { ok: false };
  }
  const p2 = (n: number) => String(n).padStart(2, "0");
  return {
    ok: true,
    date: `${year}-${p2(month)}-${p2(day)}`,
    time: `${p2(hour)}:${p2(minute)}`,
    at: new Date(Date.UTC(year, month - 1, day, hour - 8, minute)),
  };
}
