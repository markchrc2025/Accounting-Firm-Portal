// ClearCopyButton — "Download clear copy" on a filed return whose form has a
// print map (W14 R1): POST /bir-forms/:id/clear-copy, then the export's signed
// URL, then the browser takes the PDF. The server's 409 shows word for word.
//
// The tab is opened on the click itself, before the two requests, so a popup
// blocker lets it through; it is pointed at the signed URL once that arrives,
// and closed if the server refuses.

import { useRef, useState, type MouseEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createClearCopy,
  fetchBirFormExportUrl,
  type BirFormExportRef,
} from "../../lib/api";
import { exportLabel } from "../../lib/birExports";
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
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);
  // A second click can land before `isPending` disables the button; the ref
  // makes sure one click sends one POST.
  const busy = useRef(false);
  const run = useMutation({
    mutationFn: async (_tab: Window | null) => {
      const made = await createClearCopy(formId);
      const { url } = await fetchBirFormExportUrl(formId, made.id);
      return url;
    },
    onSuccess: (url, tab) => {
      setError(null);
      if (tab && !tab.closed) {
        tab.location.href = url;
      } else {
        // The browser blocked the tab: offer the link to click instead.
        setBlockedUrl(url);
      }
      void qc.invalidateQueries({ queryKey: ["bir-form", formId] });
    },
    onError: (e, tab) => {
      tab?.close();
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
    setBlockedUrl(null);
    const tab = window.open("", "_blank");
    if (tab) {
      tab.document.title = "Clear copy";
      tab.document.body.textContent = "Preparing the clear copy…";
      tab.opener = null;
    }
    run.mutate(tab);
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
      {blockedUrl ? (
        <a
          href={blockedUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-blue underline-offset-2 hover:underline"
        >
          Open the clear copy
        </a>
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
