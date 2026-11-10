// board.ts - the maths of the board (PB2): where a card lands, what it looks like at once, and
// how the keyboard steps it. Pure, so it is easy to test; the screen only calls it.
import type { Board, BoardColumn, IssueItem } from "./projects";

/** Where a card is, as column index and place in that column. */
export interface CardSpot {
  column: number;
  index: number;
  item: IssueItem;
}
/** Where a card is going: a status and a place in that column counted WITHOUT the card itself. */
export interface Target {
  statusId: string;
  index: number;
}

export function findCard(board: Board, issueKey: string): CardSpot | null {
  for (let c = 0; c < board.columns.length; c++) {
    const col = board.columns[c]!;
    const i = col.items.findIndex((x) => x.key === issueKey);
    if (i >= 0) return { column: c, index: i, item: col.items[i]! };
  }
  return null;
}

/** The cards of a column without the one being moved. */
const without = (col: BoardColumn, issueKey: string): IssueItem[] =>
  col.items.filter((x) => x.key !== issueKey);

/** A position between two neighbours; a column's ends get one step beyond. Empty column: 1. */
export function positionFor(
  before: number | undefined,
  after: number | undefined,
): number {
  if (before !== undefined && after !== undefined) return (before + after) / 2;
  if (before !== undefined) return before + 1;
  if (after !== undefined) return after - 1;
  return 1;
}

export interface PlannedMove {
  board: Board;
  /** The position to send. */
  position: number;
  /** The status to send, only when the card changes column. */
  statusId: string | null;
  /** false when the card would stay exactly where it is. */
  changed: boolean;
}

/**
 * Move a card to a place in a column. `index` counts the destination column without the card and
 * is held inside it. A card entering a Done column is given a closing moment (`nowIso`) and one
 * leaving it loses its own, as the API will do; the board is asked for again afterwards anyway.
 */
export function planMove(
  board: Board,
  issueKey: string,
  target: Target,
  nowIso: string,
): PlannedMove | null {
  const from = findCard(board, issueKey);
  const toCol = board.columns.findIndex((c) => c.status.id === target.statusId);
  if (!from || toCol < 0) return null;
  const dest = board.columns[toCol]!;
  const rest = without(dest, issueKey);
  const index = Math.max(0, Math.min(target.index, rest.length));
  const sameColumn = from.column === toCol;
  const changed = !(sameColumn && from.index === index);
  const position = changed
    ? positionFor(rest[index - 1]?.position, rest[index]?.position)
    : from.item.position;

  const wasDone = board.columns[from.column]!.status.category === "DONE";
  const isDone = dest.status.category === "DONE";
  const moved: IssueItem = {
    ...from.item,
    position,
    status: {
      id: dest.status.id,
      name: dest.status.name,
      colour: dest.status.colour,
      category: dest.status.category,
    },
    closedAt: isDone
      ? wasDone
        ? from.item.closedAt
        : nowIso
      : wasDone
        ? null
        : from.item.closedAt,
    overdue: from.item.dueDate !== null && !isDone && from.item.dueDate < board.today,
  };
  const columns = board.columns.map((col, c) => {
    if (c === toCol) {
      const items = [...rest.slice(0, index), moved, ...rest.slice(index)];
      return { ...col, items };
    }
    if (c === from.column) return { ...col, items: without(col, issueKey) };
    return col;
  });
  return {
    board: { ...board, columns },
    position,
    statusId: sameColumn ? null : dest.status.id,
    changed,
  };
}

export type Step = "left" | "right" | "up" | "down";

/** One keyboard step from a place: to the next column (same row, held inside it), or up or down. */
export function stepTarget(
  board: Board,
  issueKey: string,
  at: Target,
  step: Step,
): Target {
  const col = board.columns.findIndex((c) => c.status.id === at.statusId);
  if (col < 0) return at;
  if (step === "up") return { ...at, index: Math.max(0, at.index - 1) };
  if (step === "down") {
    const len = without(board.columns[col]!, issueKey).length;
    return { ...at, index: Math.min(len, at.index + 1) };
  }
  const next = col + (step === "left" ? -1 : 1);
  const dest = board.columns[next];
  if (!dest) return at;
  return {
    statusId: dest.status.id,
    index: Math.min(at.index, without(dest, issueKey).length),
  };
}

/** The place in a column (without the card) a pointer at height `y` is over, given card middles. */
export function indexAtPointer(middles: number[], y: number): number {
  let n = 0;
  for (const m of middles) if (y > m) n++;
  return n;
}

/** The spot of a card as a target, so a keyboard grab starts where the card is. */
export function targetOf(board: Board, issueKey: string): Target | null {
  const s = findCard(board, issueKey);
  return s ? { statusId: board.columns[s.column]!.status.id, index: s.index } : null;
}
