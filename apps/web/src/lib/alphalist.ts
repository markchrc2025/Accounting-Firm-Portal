// alphalist.ts — what the 1601-EQ's alphalist panel and the Mark as filed step say of
// the API's alphalist check (W19, Track A U19). The API checks the file against the BIR
// Validation program's rules and gives every refusal and note in a sentence; nothing here
// rewords one or works out a figure. These are the few sentences the web says itself.

import type { AlphalistCheck } from "./api";

/** Under the download button, always: the Portal's file is not the one that is submitted. */
export const VALIDATE_NOTE =
  "Before eSubmission, open this file in the BIR Alphalist Validation program and validate it. Submit the validated file, not this one.";

/** In the Mark as filed window, when the alphalist cannot be made. */
export const ALPHALIST_PROBLEMS =
  "The alphalist has problems. If you file now, no alphalist will be stored and it cannot be made later.";

/** In the Mark as filed window, when it can. */
export const ALPHALIST_WILL_STORE = "The alphalist will be stored with the filed return.";

/** The tick the owner gives before filing without an alphalist. */
export const UNDERSTAND_LABEL = "I understand";

/** The download is offered only when the check says the file can be made. */
export const canDownload = (c: AlphalistCheck | undefined): boolean =>
  !!c && c.ok === true && !!c.fileName;

/** Schedule 2 is shown only when it has rows. */
export const showsSchedule2 = (c: AlphalistCheck): boolean => c.schedule2.rows > 0;

/** Whether filing needs the owner's tick: the check ran and said the alphalist cannot be
 *  made, or it could not run at all (so nothing says it can). */
export function needsUnderstanding(
  check: AlphalistCheck | undefined,
  failed: boolean,
): boolean {
  if (failed) return true;
  return !!check && check.ok === false;
}

/** Filing may go ahead: nothing to understand, or the owner ticked. */
export const mayFile = (
  check: AlphalistCheck | undefined,
  failed: boolean,
  pending: boolean,
  ticked: boolean,
): boolean => !pending && (!needsUnderstanding(check, failed) || ticked);
