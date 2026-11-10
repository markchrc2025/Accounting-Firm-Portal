// undoFiling.ts — what the web says of "Undo filing" (W22, Track A U22): who is offered
// the button, the owner's words in the confirmation, and the contact-number hint. The API
// decides everything else and its sentences (403, 400, both 409s) are shown as sent.

import type { BirFormDetail, BirFormSummary } from "./api";

/** In the Undo filing window, word for word. */
export const UNDO_FILING_TEXT =
  "Use this only when the return never reached the BIR. The return goes back to draft with its figures as filed. The filing is kept in the return's history and cannot be deleted. Then mark it filed again with the BIR confirmation email.";

/** The reason is at least this long; the API decides, the counter shows it. */
export const UNDO_REASON_MIN_LENGTH = 10;

/** Under the client form's phone field. Saving is never blocked: the API checks the
 *  number only where a return leaves the Portal. */
export const CONTACT_HINT = "Contact number: 11 digits, like 09171234567";

/** Whether a later amendment names this return, from the client's list of returns. */
export const hasAmendmentIn = (list: BirFormSummary[] | undefined, id: string): boolean =>
  !!list && list.some((f) => f.amendsId === id);

/**
 * Whether the card offers "Undo filing": a Super Admin, on a filed return whose live
 * confirmation is an override (filed without the BIR email), with no amendment.
 * `amended` is undefined while that is not known yet; the API refuses in words if the
 * list could not say.
 */
export function offersUndo(
  detail: Pick<BirFormDetail, "status" | "confirmation">,
  superAdmin: boolean,
  amended: boolean | undefined,
): boolean {
  return (
    superAdmin &&
    detail.status === "filed" &&
    detail.confirmation?.kind === "override" &&
    amended !== true
  );
}

/** A draft that was filed and had its filing undone keeps its history; it cannot be deleted. */
export const hasFilingHistory = (detail: Pick<BirFormDetail, "filingUndos">): boolean =>
  (detail.filingUndos?.length ?? 0) > 0;
