// BoardTab - a project's board (PB2): one column per status, in the firm's order, with a card per
// issue. A card moves by dragging it to another column (its status changes) or to another place in
// its column (it is reordered), or from the keyboard: focus a card, press Space to pick it up, move
// it with the arrow keys, Space to drop it, Escape to cancel. The card moves at once; if the API
// refuses, it goes back and the API's sentence shows as sent. Done columns hold the last 14 days
// with a "Show all" switch and a note of how many older cards are left out.
//
// Drag and drop is the browser's own (HTML drag and drop); there is no library. See the PB2 report.

import {
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, ErrorState, Skeleton, cn } from "../../components/ui";
import { ColourChip, ErrorBanner, PriorityChip } from "../../components/projects/parts";
import { DueText } from "../../components/projects/IssueRows";
import { useInvalidateProject } from "../../components/projects/useInvalidate";
import {
  findCard,
  indexAtPointer,
  planMove,
  stepTarget,
  targetOf,
  type Step,
  type Target,
} from "../../lib/board";
import {
  errorLines,
  fetchBoard,
  fetchMilestones,
  issuePath,
  reorderIssue,
  type Board,
  type BoardFilters,
  type IssueItem,
  type ProjectsCan,
  type ProjectsMeta,
} from "../../lib/projects";

const KEY_STEPS: Record<string, Step> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

interface MoveVars {
  issueKey: string;
  position: number;
  statusId: string | null;
  /** The board as it was before the move, to go back to if the API refuses. */
  prev: Board | undefined;
}

/** "In progress, position 2 of 4" for a card at a place on a board. */
function placeText(board: Board, issueKey: string): string {
  const s = findCard(board, issueKey);
  if (!s) return "";
  const col = board.columns[s.column]!;
  return `${col.status.name}, position ${s.index + 1} of ${col.items.length}`;
}

export function BoardTab({
  projectKey,
  can,
  meta,
}: {
  projectKey: string;
  can: ProjectsCan;
  meta: ProjectsMeta;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const invalidate = useInvalidateProject(projectKey);
  const [sp, setSp] = useSearchParams();
  const filters: BoardFilters = {
    milestone: sp.get("milestone") ?? "",
    assignee: sp.get("assignee") ?? "",
    doneAll: sp.get("done") === "all",
  };
  const setFilter = (name: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(name, value);
    else next.delete(name);
    setSp(next, { replace: true });
  };

  const boardKey = ["projects", "board", projectKey, filters] as const;
  // a change of filter keeps the board on screen (and the filters under the pointer) until the
  // new one arrives
  const board = useQuery({
    queryKey: boardKey,
    queryFn: () => fetchBoard(projectKey, filters),
    placeholderData: keepPreviousData,
  });
  const milestones = useQuery({
    queryKey: ["projects", "milestones", projectKey],
    queryFn: () => fetchMilestones(projectKey),
  });

  const [failed, setFailed] = useState<string[]>([]);
  const [live, setLive] = useState("");
  // keyboard: the card picked up, where it started and where it would land
  const [grab, setGrab] = useState<{ key: string; from: Target; at: Target } | null>(
    null,
  );
  // mouse: the card being dragged and the place the pointer is over
  const [drag, setDrag] = useState<{ key: string; over: Target | null } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);

  const move = useMutation({
    mutationKey: ["projects", "board-move", projectKey],
    mutationFn: (v: MoveVars) =>
      reorderIssue(projectKey, v.issueKey, {
        position: v.position,
        ...(v.statusId ? { statusId: v.statusId } : {}),
      }),
    onMutate: () => setFailed([]),
    onError: (e, v) => {
      // the card goes back to where it was, and the API's sentence shows as sent
      if (v.prev) qc.setQueryData<Board>(boardKey, v.prev);
      const lines = errorLines(e);
      setFailed(lines);
      setLive(`Could not move ${v.issueKey}. ${lines.join(" ")}`);
    },
    onSettled: () => {
      // only when no other move is still on its way, or its answer would be overwritten
      if (qc.isMutating({ mutationKey: ["projects", "board-move", projectKey] }) <= 1) {
        invalidate();
      }
    },
  });

  // after a keyboard move the card may be a new element: give it the focus again
  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    const el = root.current?.querySelector<HTMLElement>(`[data-card="${key}"]`);
    if (el && document.activeElement !== el) el.focus();
  });

  const data = board.data;
  // A picked up card moves on screen at once as the arrow keys are pressed. A dragged card stays
  // where it is (the browser needs its element) and a gold line shows where it would land.
  const preview =
    data && grab
      ? (planMove(data, grab.key, grab.at, new Date().toISOString())?.board ?? data)
      : (data ?? null);

  function commit(issueKey: string, to: Target) {
    if (!data) return;
    const plan = planMove(data, issueKey, to, new Date().toISOString());
    if (!plan || !plan.changed) return;
    // The card moves in the same render that drops it, so a card with the keyboard focus is never
    // taken out of the page and put back (which would lose the focus).
    const prev = qc.getQueryData<Board>(boardKey);
    void qc.cancelQueries({ queryKey: ["projects", "board", projectKey] });
    qc.setQueryData<Board>(boardKey, plan.board);
    move.mutate({
      issueKey,
      position: plan.position,
      statusId: plan.statusId,
      prev,
    });
  }

  // ---- the keyboard
  function onCardKey(e: KeyboardEvent<HTMLElement>, item: IssueItem) {
    if (e.target !== e.currentTarget || !data) return;
    const isGrabbed = grab?.key === item.key;
    if (!isGrabbed) {
      if (e.key === " " && can.update) {
        e.preventDefault();
        const at = targetOf(data, item.key);
        if (!at) return;
        setGrab({ key: item.key, from: at, at });
        pendingFocus.current = item.key;
        setLive(
          `Picked up ${item.key}. ${placeText(data, item.key)}. Use the arrow keys to move it, Space to drop it, Escape to cancel.`,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        navigate(issuePath(item.project.key, item.key));
      }
      return;
    }
    const step = KEY_STEPS[e.key];
    if (step) {
      e.preventDefault();
      const at = stepTarget(data, item.key, grab.at, step);
      setGrab({ ...grab, at });
      pendingFocus.current = item.key;
      const shown = planMove(data, item.key, at, new Date().toISOString())?.board;
      if (shown) setLive(`${item.key} now in ${placeText(shown, item.key)}.`);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const shown = planMove(data, item.key, grab.at, new Date().toISOString());
      setGrab(null);
      pendingFocus.current = item.key;
      if (shown?.changed) {
        commit(item.key, grab.at);
        setLive(`Dropped ${item.key} in ${placeText(shown.board, item.key)}.`);
      } else {
        setLive(`Dropped ${item.key} where it was.`);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setGrab(null);
      pendingFocus.current = item.key;
      setLive(`Move cancelled. ${item.key} is back in ${placeText(data, item.key)}.`);
    }
  }
  function onCardBlur(item: IssueItem) {
    if (grab?.key !== item.key) return;
    // a card that moved column is a new element and blurs once; give it a moment to be focused again
    window.setTimeout(() => {
      const now = document.activeElement as HTMLElement | null;
      if (now?.getAttribute("data-card") !== item.key) {
        setGrab((g) => (g?.key === item.key ? null : g));
      }
    }, 0);
  }

  // ---- the mouse
  function overColumn(e: DragEvent<HTMLElement>, statusId: string) {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const cards = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("[data-card]"),
    ).filter((c) => c.getAttribute("data-card") !== drag.key);
    const middles = cards.map((c) => {
      const r = c.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    const index = indexAtPointer(middles, e.clientY);
    if (drag.over?.statusId !== statusId || drag.over.index !== index) {
      setDrag({ ...drag, over: { statusId, index } });
    }
  }
  function dropOn(e: DragEvent<HTMLElement>, statusId: string) {
    if (!drag) return;
    e.preventDefault();
    const to = drag.over?.statusId === statusId ? drag.over : { statusId, index: 0 };
    const key = drag.key;
    setDrag(null);
    commit(key, to);
  }

  if (board.isPending || milestones.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton />
        <Skeleton className="w-2/3" />
      </div>
    );
  }
  if (board.isError || !data || !preview) {
    return (
      <>
        <ErrorBanner lines={errorLines(board.error)} className="mb-3" />
        <ErrorState
          message="Could not load the board."
          onRetry={() => void board.refetch()}
        />
      </>
    );
  }
  const hasDone = data.columns.some((c) => c.status.category === "DONE");

  return (
    <div ref={root} data-board>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-[12px] text-content-secondary">
          <span className="eyebrow mb-1 block">Milestone</span>
          <select
            aria-label="Milestone"
            className="input"
            value={filters.milestone}
            onChange={(e) => setFilter("milestone", e.target.value)}
          >
            <option value="">Any milestone</option>
            <option value="none">No milestone</option>
            {(milestones.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] text-content-secondary">
          <span className="eyebrow mb-1 block">Assignee</span>
          <select
            aria-label="Assignee"
            className="input"
            value={filters.assignee}
            onChange={(e) => setFilter("assignee", e.target.value)}
          >
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="none">Unassigned</option>
            {meta.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName}
              </option>
            ))}
          </select>
        </label>
        {hasDone ? (
          <Button
            variant="outline"
            aria-pressed={filters.doneAll}
            onClick={() => setFilter("done", filters.doneAll ? "" : "all")}
          >
            {filters.doneAll ? "Show last 14 days" : "Show all"}
          </Button>
        ) : null}
        {can.update ? (
          <p className="ml-auto max-w-[420px] text-[12px] text-content-secondary">
            Drag a card to another column to change its status, or up and down to reorder.
            With the keyboard: focus a card, press Space, use the arrow keys, then Space
            to drop it.
          </p>
        ) : null}
      </div>
      {failed.length > 0 ? <ErrorBanner lines={failed} className="mb-3" /> : null}
      <div className="sr-only" aria-live="polite" role="status" data-board-live>
        {live}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-3">
        {preview.columns.map((col) => {
          const dragging = drag?.key ?? null;
          const marker = drag?.over?.statusId === col.status.id ? drag.over.index : null;
          let shownCards = 0;
          const rows: ReactNode[] = [];
          col.items.forEach((item, i) => {
            const isDragged = item.key === dragging;
            if (!isDragged) {
              if (marker === shownCards) rows.push(<DropMark key="mark" />);
              shownCards++;
            }
            rows.push(
              <BoardCard
                key={item.id}
                item={item}
                position={i + 1}
                count={col.items.length}
                statusName={col.status.name}
                grabbed={grab?.key === item.key}
                dragged={isDragged}
                canMove={can.update}
                onKeyDown={(e) => onCardKey(e, item)}
                onBlur={() => onCardBlur(item)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", item.key);
                  setDrag({ key: item.key, over: null });
                }}
                onDragEnd={() => setDrag(null)}
              />,
            );
          });
          if (marker !== null && marker >= shownCards) rows.push(<DropMark key="mark" />);
          return (
            <section
              key={col.status.id}
              data-column={col.status.id}
              data-column-name={col.status.name}
              aria-label={`${col.status.name}, ${col.items.length} ${col.items.length === 1 ? "card" : "cards"}`}
              className="w-[272px] flex-none rounded-card border border-line bg-paper"
              onDragOver={can.update ? (e) => overColumn(e, col.status.id) : undefined}
              onDrop={can.update ? (e) => dropOn(e, col.status.id) : undefined}
            >
              <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: col.status.colour }}
                />
                <h2 className="text-[13px] font-semibold text-navy">{col.status.name}</h2>
                <span
                  data-column-count
                  className="font-mono text-[11px] text-content-secondary"
                >
                  {col.items.length}
                </span>
              </header>
              {col.olderHidden > 0 ? (
                <p
                  data-older-hidden={col.olderHidden}
                  className="border-b border-line px-3 py-1.5 text-[11.5px] text-content-secondary"
                >
                  {col.olderHidden} older {col.olderHidden === 1 ? "card" : "cards"}{" "}
                  hidden
                </p>
              ) : null}
              <ul className="min-h-[72px] space-y-2 p-2">
                {rows}
                {col.items.length === 0 && marker === null ? (
                  <li className="px-2 py-4 text-center text-[12px] text-content-secondary">
                    No cards
                  </li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function DropMark() {
  return <li aria-hidden data-drop-mark className="h-1 rounded-full bg-gold" />;
}

// One card on the board.
function BoardCard(props: {
  item: IssueItem;
  position: number;
  count: number;
  statusName: string;
  grabbed: boolean;
  dragged: boolean;
  canMove: boolean;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  onBlur: () => void;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const { item: i } = props;
  const label = [
    `${i.key}, ${i.title}.`,
    `${props.statusName}, position ${props.position} of ${props.count}.`,
    `${i.priority.charAt(0)}${i.priority.slice(1).toLowerCase()} priority.`,
    i.assignee ? `Assigned to ${i.assignee.fullName}.` : "Unassigned.",
    i.dueDate ? `${i.overdue ? "Overdue, due" : "Due"} ${i.dueDate}.` : "",
    props.grabbed
      ? "Picked up. Arrow keys move it, Space drops it, Escape cancels."
      : props.canMove
        ? "Space picks it up, Enter opens it."
        : "Enter opens it.",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <li>
      <div
        data-card={i.key}
        data-grabbed={props.grabbed ? "true" : undefined}
        tabIndex={0}
        role="group"
        aria-roledescription="card"
        aria-label={label}
        draggable={props.canMove}
        onKeyDown={props.onKeyDown}
        onBlur={props.onBlur}
        onDragStart={props.onDragStart}
        onDragEnd={props.onDragEnd}
        className={cn(
          "rounded-input border bg-card px-3 py-2.5 text-[13px] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue",
          props.grabbed ? "border-gold ring-2 ring-gold" : "border-line-strong",
          props.dragged ? "opacity-40" : "",
          props.canMove ? "cursor-grab" : "",
        )}
      >
        <div className="flex items-center gap-2">
          <Link
            to={issuePath(i.project.key, i.key)}
            tabIndex={-1}
            draggable={false}
            className="font-mono text-[11.5px] font-semibold text-blue underline-offset-2 hover:underline"
          >
            {i.key}
          </Link>
          <ColourChip name={i.type.name} colour={i.type.colour} />
          <span className="ml-auto">
            <PriorityChip priority={i.priority} />
          </span>
        </div>
        <p className="mt-1.5 text-content">{i.title}</p>
        {i.labels.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {i.labels.map((l) => (
              <ColourChip key={l.id} name={l.name} colour={l.colour} />
            ))}
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[12px] text-content-secondary">
            {i.assignee ? i.assignee.fullName : "Unassigned"}
          </span>
          <DueText issue={i} />
        </div>
      </div>
    </li>
  );
}
