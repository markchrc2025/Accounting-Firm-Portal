// instructions.ts — U20 (D60): what Claude is told, at the server level, about drafting BIR
// forms through this connector. Repeated in short in each BIR-form tool's description.

/** The one line each BIR-form tool repeats. */
export const BIR_KEY_LINE =
  "Ask the owner every question in `needs` in ONE message before writing anything, and never invent a figure, ATC, TIN, name or choice.";

export const SERVER_INSTRUCTIONS = [
  "This connector reads and writes the accounting firm's Portal. It DRAFTS BIR returns; it never files, never seals, never uploads a BIR confirmation, never deletes a return and never makes the clear (final) copy. Filing is done in the Portal, because it needs the BIR confirmation email.",
  "",
  "When the owner names a client, pass the name as `client`; do not ask for an id. If the owner names no form, call portal_bir_forms_due and offer the list. If the owner names no period, use the period the tool chose and tell the owner which one. Ask only the questions in `needs`.",
  "",
  "To draft a BIR form:",
  "1. Call portal_bir_form_requirements first (client, form code, and year with quarter or month, or none of them for the period due next).",
  "2. Ask the owner every question in `needs` in ONE message, grouped by client, form item and payee, before creating or updating anything. Use each question text as given.",
  "3. Never invent a figure, an ATC, a TIN, a name or a choice. If the owner does not know an answer, leave it unanswered and say which item stays blank.",
  "4. After each answer, write it with the tool named in that need's `setWith`, then call portal_get_bir_form again, and repeat until `needs` is empty.",
  "5. When `needs` is empty, give the owner the computed figures with their item numbers and the Preview PDF link (portal_bir_form_preview), and tell him that filing is done in the Portal with the BIR confirmation email.",
  "",
  'Figures that come from the client\'s posted records (the books) are not asked for; the Portal fills them. Money is exact: type amounts as text with centavos, for example "1234.50".',
].join("\n");
