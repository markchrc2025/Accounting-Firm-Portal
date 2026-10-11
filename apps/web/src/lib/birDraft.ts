// birDraft.ts — deleting a draft return (W15 R1): the dialog's own sentence.

/** "The draft <form> for <period> for <client> will be removed. …" */
export function deleteDraftBody(d: {
  form: string;
  period: string;
  clientName: string;
}): string {
  return (
    `The draft ${d.form} for ${d.period} for ${d.clientName} will be removed. ` +
    "This can't be undone. Filed returns are never affected."
  );
}
