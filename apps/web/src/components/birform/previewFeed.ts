// previewFeed — how each BIR editor tells the shared page what it would save (W23).
//
// The Preview pane lives once, in the shared editor page; the editors keep their own
// state. Each editor publishes its WHOLE data object (exactly what its Save sends) and its
// period through usePublishPreviewFeed; the page reads it. Outside the page (a test that
// renders one editor on its own) there is no provider and publishing does nothing.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { hasUnsavedChanges, stable } from "../../lib/birPreview";

export interface PreviewFeed {
  data: Record<string, unknown>;
  /** The period the editor would save with it. */
  period: string;
  /** Equal for equal data and period. */
  key: string;
}

type Publish = (feed: PreviewFeed) => void;

export const PreviewFeedContext = createContext<Publish | undefined>(undefined);

/** For an editor: publish what it would save. Call it once, before any early return. */
export function usePublishPreviewFeed(
  data: Record<string, unknown>,
  period: string,
): void {
  const publish = useContext(PreviewFeedContext);
  const latest = useRef(data);
  latest.current = data;
  const key = `${period}|${stable(data)}`;
  useEffect(() => {
    publish?.({ data: latest.current, period, key });
  }, [publish, period, key]);
}

/** For the page: the latest feed, and the function the editors publish with. */
export function usePreviewFeedStore(): { feed: PreviewFeed | null; publish: Publish } {
  const [feed, setFeed] = useState<PreviewFeed | null>(null);
  const publish = useCallback<Publish>(
    (next) => setFeed((prev) => (prev?.key === next.key ? prev : next)),
    [],
  );
  return { feed, publish };
}

/**
 * Whether the editor's data is its own, hydrated from the saved form: either it has
 * reproduced the saved form (nothing unsaved), or it has changed at least once since it
 * mounted (an editor starts with empty boxes, then hydrates). Until then nothing is asked.
 */
export function useEditorReady(
  feed: PreviewFeed | null,
  saved: { period: string; data: Record<string, unknown> } | undefined,
): boolean {
  const [ready, setReady] = useState(false);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!feed || ready) return;
    seen.current.add(feed.key);
    const reproduced = !!saved && !hasUnsavedChanges(saved, feed.period, feed.data);
    if (reproduced || seen.current.size >= 2) setReady(true);
  }, [feed, saved, ready]);
  return ready;
}
