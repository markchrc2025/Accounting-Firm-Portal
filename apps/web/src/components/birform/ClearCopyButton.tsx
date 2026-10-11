// ClearCopyButton — "Download clear copy" on a filed return whose form has a
// print map (W14 R1): POST /bir-forms/:id/clear-copy, then the export's signed
// URL, then the browser saves the PDF. The server's 409 shows word for word.
//
// W15 R2: the signed link is an attachment with the export's own filename
// (Track A U14), so the page follows it in place and the file downloads. No
// new tab is opened, so no popup blocker stands in the way.

import { useRef, useState, type MouseEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createClearCopy,
  fetchBirFormExportUrl,
  type BirFormExportRef,
} from "../../lib/api";
import { exportLabel } from "../../lib/birExports";
import { downloadFromUrl } from "../../lib/download";
import { Button } from "../ui";

export function ClearCopyButton({
  formId,
  size = "md",
}: {
  formId: string;
  size?: "sm" | "md";
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // A second click can land before `isPending` disables the button; the ref
  // makes sure one click sends one POST.
  const busy = useRef(false);
  const run = useMutation({
    mutationFn: async () => {
      const made = await createClearCopy(formId);
      const { url } = await fetchBirFormExportUrl(formId, made.id);
      return { url, filename: made.filename };
    },
    onSuccess: ({ url, filename }) => {
      setError(null);
      downloadFromUrl(url, filename);
      void qc.invalidateQueries({ queryKey: ["bir-form", formId] });
    },
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : "Could not prepare the clear copy.");
    },
    onSettled: () => {
      busy.current = false;
    },
  });

  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (busy.current) return;
    busy.current = true;
    setError(null);
    run.mutate();
  };

  return (
    <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
      <Button variant="outline" size={size} disabled={run.isPending} onClick={onClick}>
        {run.isPending ? "Preparing…" : "Download clear copy"}
      </Button>
      {error ? (
        <p data-clear-copy-error role="alert" className="text-[12px] text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** One line of a form's export list: its kind, then its file name (W14 R2). */
export function ExportListItem({ item }: { item: BirFormExportRef }) {
  return (
    <li data-export-kind={item.kind} className="text-[11.5px] text-content-secondary">
      <span className="font-semibold text-content">{exportLabel(item.kind)}</span>{" "}
      <span className="font-mono">{item.filename}</span>
    </li>
  );
}
