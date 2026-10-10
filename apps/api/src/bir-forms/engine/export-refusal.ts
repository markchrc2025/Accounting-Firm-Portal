// export-refusal.ts — a return the eBIRForms export cannot carry faithfully (U13).
// The builders throw it instead of writing a file that differs from the return;
// the service answers 409 with its message, which the user reads as it is.

export class ExportRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportRefusal";
  }
}

/** A date as eBIRForms writes it, yyyy/mm/dd, on the Manila calendar (UTC+8). */
export function manilaDate(d: Date): string {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "/");
}
