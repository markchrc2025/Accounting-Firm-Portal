// parts.tsx - the small pieces the Projects screens share (PB1): a progress bar, the status,
// type, priority and label chips, the banner for what the API said, and rendered markdown.

import { useMemo, type MouseEvent, type ReactNode } from "react";
import { useQueries } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Chip, cn } from "../ui";
import { findIssueKeys, linkIssueKeys, renderMarkdown } from "../../lib/markdown";
import {
  issuePath,
  lookupIssueKey,
  PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_VARIANT,
  projectKeyOf,
  type IssueItem,
  type Priority,
  type ProjectStatus,
} from "../../lib/projects";

/** Done over total as a bar. The numbers are the API's, never worked out here. */
export function ProgressBar({
  done,
  total,
  percent,
  className,
}: {
  done: number;
  total: number;
  percent: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${done} of ${total} done`}
        className="h-2 min-w-[72px] flex-1 overflow-hidden rounded-full bg-line"
      >
        <div
          className="h-full rounded-full bg-success"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span
        data-progress-text
        className="whitespace-nowrap font-mono text-[11px] text-content-secondary"
      >
        {done}/{total}
      </span>
    </div>
  );
}

export function ProjectStatusChip({ status }: { status: ProjectStatus }) {
  return (
    <Chip variant={PROJECT_STATUS_VARIANT[status]} data-project-status={status}>
      {PROJECT_STATUS_LABEL[status]}
    </Chip>
  );
}

/** A chip in a colour the firm chose (issue types, statuses and labels carry a hex colour). */
export function ColourChip({ name, colour }: { name: string; colour: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-chip px-[9px] py-[3px] text-[11px] font-semibold leading-none"
      style={{ color: colour, backgroundColor: `${colour}1a` }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: colour }}
      />
      {name}
    </span>
  );
}

const PRIORITY_VARIANT: Record<Priority, "neutral" | "info" | "warn" | "danger"> = {
  LOW: "neutral",
  NORMAL: "info",
  HIGH: "warn",
  URGENT: "danger",
};
export function PriorityChip({ priority }: { priority: Priority }) {
  return <Chip variant={PRIORITY_VARIANT[priority]}>{PRIORITY_LABEL[priority]}</Chip>;
}

/** What the API said when it refused or failed: its sentences, as sent, in the Portal's red. */
export function ErrorBanner({
  lines,
  className,
}: {
  lines: string[];
  className?: string;
}) {
  if (lines.length === 0) return null;
  return (
    <div
      role="alert"
      data-projects-error
      className={cn(
        "rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink",
        className,
      )}
    >
      {lines.length === 1 ? (
        <p>{lines[0]}</p>
      ) : (
        <ul className="list-disc space-y-0.5 pl-5">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A short confirmation of what was just done, in the Portal's green. */
export function SuccessBanner({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      data-projects-success
      className={cn(
        "flex items-center gap-2 rounded-input border border-success/30 bg-success-bg px-3.5 py-2.5 text-[13px] text-content",
        className,
      )}
    >
      <span aria-hidden className="font-semibold text-success">
        ✓
      </span>
      {children}
    </div>
  );
}

/** A labelled field of a form. */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] font-semibold text-content">{label}</span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[11.5px] text-content-secondary">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * Markdown, sanitised. Issue keys that exist (the API is asked, once each) become links to
 * the issue; a click goes there inside the Portal without a page load.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const navigate = useNavigate();
  const base = useMemo(() => renderMarkdown(text), [text]);
  const candidates = useMemo(() => findIssueKeys(base).slice(0, 25), [base]);
  const lookups = useQueries({
    queries: candidates.map((key) => ({
      queryKey: ["projects", "issue-key", key],
      queryFn: () => lookupIssueKey(key),
      retry: false,
      staleTime: 5 * 60_000,
    })),
  });
  const found = new Set<string>();
  candidates.forEach((key, i) => {
    const d = lookups[i]?.data as IssueItem | undefined;
    if (d) found.add(key);
  });
  const html = useMemo(
    () =>
      found.size === 0
        ? linkIssueKeys(base, () => false)
        : linkIssueKeys(base, (k) => found.has(k)),
    // `found` is rebuilt every render; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, [...found].join(",")],
  );
  function onClick(e: MouseEvent<HTMLDivElement>) {
    const a = (e.target as HTMLElement).closest("a[data-issue-key]");
    if (!a) return;
    e.preventDefault();
    const key = a.getAttribute("data-issue-key")!;
    navigate(issuePath(projectKeyOf(key), key));
  }
  return (
    <div
      data-markdown
      className={cn("markdown-body", className)}
      onClick={onClick}
      // The HTML was produced by renderMarkdown: sanitised, with only existing keys linked.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** A window over the page, closed by Escape or the backdrop; the Portal's own look (cf. ConfirmDialog). */
export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "max-h-[90vh] w-full overflow-y-auto rounded-card border border-line bg-card shadow-xl",
          wide ? "max-w-2xl" : "max-w-lg",
        )}
      >
        <h2 className="px-6 pb-1 pt-5 font-serif text-[18px] font-medium text-navy">
          {title}
        </h2>
        <div className="px-6 pb-5 pt-2">{children}</div>
      </div>
    </div>
  );
}
