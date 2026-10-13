// PreviewPdfButton — "Preview PDF" on a draft whose form has a print map
// (C3, D52): the draft printed on the BIR's own blank form, stamped
// "DRAFT — NOT FILED". Unsaved changes are saved first, exactly as
// "Save changes" saves them; if that save fails, its message shows (the
// editor's own) and nothing downloads. Then one POST, and the PDF downloads in
// the page under the server's filename (W15's in-page download): no new tab.
// The server's 409 shows word for word.

import { useRef, useState } from "react";
import { ApiError, previewBirFormPdf } from "../../lib/api";
import { downloadBlob } from "../../lib/download";
import { Button } from "../ui";

export function PreviewPdfButton({
  formId,
  dirty,
  save,
}: {
  formId: string;
  /** The editor holds changes the server does not have yet. */
  dirty: boolean;
  /** The editor's own save ("Save changes"); rejects when the save fails. */
  save: () => Promise<unknown>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A second click can land before the button disables; one click, one POST.
  const busy = useRef(false);

  async function onClick() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      if (dirty) {
        try {
          await save();
        } catch {
          return; // the editor shows the save's own message; nothing downloads
        }
      }
      const { blob, filename } = await previewBirFormPdf(formId);
      downloadBlob(blob, filename);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not prepare the preview.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" disabled={pending} onClick={() => void onClick()}>
        {pending ? "Preparing…" : "Preview PDF"}
      </Button>
      {error ? (
        <p data-preview-error role="alert" className="text-[12px] text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
