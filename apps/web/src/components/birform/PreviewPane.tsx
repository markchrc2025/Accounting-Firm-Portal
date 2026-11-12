// PreviewPane - the Form details | Preview tabs of every BIR form editor (W25, replacing the
// W23 side pane; Track A U23). They sit directly under the page title: the editor's own
// PageHeader renders the PageHeaderSlot, which this page fills, so the twelve editors carry no
// tab code of their own. Form details is the editor, kept mounted while Preview is shown (only
// hidden, so nothing typed is lost). Preview shows the PDF the API renders, inline and tall,
// with every refusal as the API sent it; nothing is worked out here and nothing is asked while
// Form details is shown (see useLivePreview).

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { BirFormDetail } from "../../lib/api";
import { PREVIEW_FAILED, PREVIEW_UPDATING, SAVE_TO_PREVIEW } from "../../lib/livePreview";
import { PageHeaderSlot } from "../pageHeaderSlot";
import { Button, Card, cn } from "../ui";
import {
  PreviewFeedContext,
  SaveActionContext,
  useEditorReady,
  usePreviewFeedStore,
  type SaveAction,
} from "./previewFeed";
import { useLivePreview } from "./useLivePreview";

export type EditorTab = "details" | "preview";
const TABS: { id: EditorTab; label: string }[] = [
  { id: "details", label: "Form details" },
  { id: "preview", label: "Preview" },
];

/**
 * While Preview is shown, everything the editor renders after the tabs (its whole form) is
 * hidden, not unmounted. One rule, scoped to this page's tab bar.
 */
const HIDE_FORM_RULE =
  '[data-bir-tabs][data-tab="preview"] ~ * { display: none !important; }';

export function EditorWithPreview({
  editor,
  form,
  id,
  detail,
  below,
}: {
  /** The form's editor. */
  editor: ReactNode;
  form: string | undefined;
  /** The saved form's id; undefined on /bir-forms/new. */
  id: string | undefined;
  detail: BirFormDetail | undefined;
  /** What follows the form on the Form details tab (the filings taken back). */
  below?: ReactNode;
}) {
  const [tab, setTab] = useState<EditorTab>("details");
  const [saveAction, setSaveAction] = useState<SaveAction | null>(null);
  const { feed, publish } = usePreviewFeedStore();
  const ready = useEditorReady(feed, detail);
  const preview = useLivePreview({
    active: tab === "preview",
    form,
    id,
    status: detail?.status,
    ready,
    data: feed?.data ?? null,
    exports: detail?.exports,
  });

  const tabs = (
    <EditorTabs tab={tab} onTab={setTab}>
      {tab === "preview" ? (
        <PreviewPanel
          saved={!!id}
          preview={preview}
          save={saveAction && !saveAction.hidden ? saveAction : null}
        />
      ) : null}
    </EditorTabs>
  );

  return (
    <PreviewFeedContext.Provider value={publish}>
      <SaveActionContext.Provider value={setSaveAction}>
        <PageHeaderSlot.Provider value={tabs}>
          <style>{HIDE_FORM_RULE}</style>
          {editor}
          {below ? <div hidden={tab === "preview"}>{below}</div> : null}
        </PageHeaderSlot.Provider>
      </SaveActionContext.Provider>
    </PreviewFeedContext.Provider>
  );
}

/** The tab bar (and, under it, the Preview panel when Preview is chosen). */
function EditorTabs({
  tab,
  onTab,
  children,
}: {
  tab: EditorTab;
  onTab: (t: EditorTab) => void;
  children: ReactNode;
}) {
  const base = useId();
  const refs = useRef<Record<EditorTab, HTMLButtonElement | null>>({
    details: null,
    preview: null,
  });
  function keys(e: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.id === tab);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const t = TABS[next]!.id;
    onTab(t);
    refs.current[t]?.focus();
  }
  return (
    <div data-bir-tabs data-tab={tab} className="mb-5">
      <div
        role="tablist"
        aria-label="Form"
        onKeyDown={keys}
        className="flex gap-1 border-b border-line"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            id={`${base}-${t.id}`}
            role="tab"
            type="button"
            data-editor-tab={t.id}
            aria-selected={tab === t.id}
            aria-controls={t.id === "preview" ? `${base}-preview-panel` : undefined}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => onTab(t.id)}
            className={cn(
              "-mb-px border-b-2 px-3.5 py-2 text-[13.5px] font-medium transition-colors",
              tab === t.id
                ? "border-gold text-navy"
                : "border-transparent text-content-secondary hover:text-navy",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "preview" ? (
        <div
          id={`${base}-preview-panel`}
          role="tabpanel"
          aria-labelledby={`${base}-preview`}
          className="pt-4"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** The panel's height: the viewport below its top, never under 600 px. */
function useFillHeight() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(600);
  useEffect(() => {
    const measure = () => {
      const top = ref.current?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(600, Math.floor(window.innerHeight - top - 24)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return { ref, height };
}

function PreviewPanel({
  saved,
  preview,
  save,
}: {
  saved: boolean;
  preview: ReturnType<typeof useLivePreview>;
  save: SaveAction | null;
}) {
  const { ref, height } = useFillHeight();
  return (
    <Card
      data-preview-pane
      className="flex w-full flex-col overflow-hidden"
      style={{ height, minHeight: 600 }}
    >
      <div
        ref={ref}
        className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5"
      >
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
          {save ? (
            <Button
              size="sm"
              data-preview-save
              disabled={save.disabled}
              onClick={() => save.run()}
            >
              {save.pending ? "Saving…" : save.label}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <PaneBody
          saved={saved}
          pdfUrl={preview.pdfUrl}
          problem={preview.problem}
          onRetry={preview.retry}
        />
      </div>
    </Card>
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
