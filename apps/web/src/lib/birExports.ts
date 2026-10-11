// birExports.ts — what a BIR form's exports are called (W14 R2): the clear
// copy printed on the BIR's own blank form, and the eBIRForms XML.

const EXPORT_LABELS: Record<string, string> = {
  pdf: "Clear copy (PDF)",
  xml: "eBIRForms file (XML)",
};

/** The export list's label for a kind; a kind it does not know shows as sent. */
export function exportLabel(kind: string): string {
  return EXPORT_LABELS[kind] ?? kind;
}
