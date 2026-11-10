// PreviewPane — the live Preview beside (wide) or below (narrow) every BIR form editor
// (W23, Track A U23). It sits once in the shared editor page. The API renders the PDF; the
// pane shows it inline, shows every refusal as the API sent it, and never works anything
// out. "Hide preview" is remembered per user in localStorage, which may be missing.

import { useState, type ReactNode } from "react";
import { useOptionalAuth } from "../../auth/AuthContext";
import type { BirFormDetail } from "../../lib/api";
import {
  PREVIEW_FAILED,
  PREVIEW_UPDATING,
  readPaneShown,
  SAVE_TO_PREVIEW,
  writePaneShown,
} from "../../lib/livePreview";
import { Button, Card, cn } from "../ui";
import { PreviewFeedContext, useEditorReady, usePreviewFeedStore } from "./previewFeed";
import { useLivePreview } from "./useLivePreview";

export function EditorWithPreview({
  editor,
  form,
  id,
  detail,
}: {
  /** The form's editor. */
  editor: ReactNode;
  form: string | undefined;
  /** The saved form's id; undefined on /bir-forms/new. */
  id: string | undefined;
  detail: BirFormDetail | undefined;
}) {
  const userId = useOptionalAuth()?.user?.id;
  // The user's choice this visit, else what is remembered for them (shown unless hidden).
  const [choice, setChoice] = useState<boolean | null>(null);
  const shown = choice ?? readPaneShown(userId);
  const { feed, publish } = usePreviewFeedStore();
  const ready = useEditorReady(feed, detail);
  const preview = useLivePreview({
    shown,
    form,
    id,
    status: detail?.status,
    ready,
    data: feed?.data ?? null,
    updatedAt: detail?.updatedAt,
    exports: detail?.exports,
  });

  function toggle(next: boolean) {
    setChoice(next);
    writePaneShown(userId, next);
  }

  return (
    <PreviewFeedContext.Provider value={publish}>
      {shown ? null : (
        <div className="mb-3 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            data-preview-toggle="show"
            onClick={() => toggle(true)}
          >
            Show preview
          </Button>
        </div>
      )}
      <div
        className={cn(
          "space-y-6 xl:space-y-0",
          shown &&
            "xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start xl:gap-6",
        )}
      >
        <div className="min-w-0">{editor}</div>
        {shown ? (
          <aside
            data-preview-pane
            aria-label="Preview"
            className="min-w-0 xl:sticky xl:top-4"
          >
            <Card className="flex h-[70vh] min-h-[420px] flex-col overflow-hidden xl:h-[calc(100vh-2rem)]">
              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="eyebrow">Preview</span>
                  {preview.updating ? (
                    <span
                      role="status"
                      data-preview-updating
                      className="text-[12px] text-content-secondary"
                    >
                      {PREVIEW_UPDATING}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  {preview.pdfUrl ? (
                    <a
                      href={preview.pdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-preview-open
                      className="text-[12.5px] text-blue underline-offset-2 hover:underline"
                    >
                      Open in new tab
                    </a>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    data-preview-toggle="hide"
                    onClick={() => toggle(false)}
                  >
                    Hide preview
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1">
                <PaneBody
                  saved={!!id}
                  pdfUrl={preview.pdfUrl}
                  problem={preview.problem}
                  onRetry={preview.retry}
                />
              </div>
            </Card>
          </aside>
        ) : null}
      </div>
    </PreviewFeedContext.Provider>
  );
}

function PaneBody({
  saved,
  pdfUrl,
  problem,
  onRetry,
}: {
  saved: boolean;
  pdfUrl: string | null;
  problem: ReturnType<typeof useLivePreview>["problem"];
  onRetry: () => void;
}) {
  if (!saved) {
    return (
      <p data-preview-save-first className="p-4 text-[13px] text-content-secondary">
        {SAVE_TO_PREVIEW}
      </p>
    );
  }
  if (problem?.kind === "refused" || problem?.kind === "invalid") {
    return (
      <ul
        role="alert"
        data-preview-problem={problem.kind}
        className="m-4 list-disc space-y-1 rounded-input border border-danger/40 bg-danger-bg py-3 pl-8 pr-4 text-[12.5px] text-danger-ink"
      >
        {problem.lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    );
  }
  if (problem?.kind === "wait") {
    return (
      <p
        role="status"
        data-preview-problem="wait"
        className="p-4 text-[13px] text-content-secondary"
      >
        {problem.line}
      </p>
    );
  }
  if (problem?.kind === "failed") {
    return (
      <div data-preview-problem="failed" className="space-y-2 p-4">
        <p role="alert" className="text-[13px] text-danger-ink">
          {PREVIEW_FAILED}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (pdfUrl) {
    return (
      <iframe
        key={pdfUrl}
        data-preview-frame
        title="Preview"
        src={pdfUrl}
        className="h-full w-full border-0"
      />
    );
  }
  return null;
}
