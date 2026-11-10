// checklist.ts: turns a markdown checklist into issues to create.
//
// Pure: a string in, a plain object out. The behaviour is ported from the owner's
// Sentire Projects importer (parseChecklist and importChecklist), with the differences listed
// in README.md ("Decisions that were not given").

/** The most items one import may hold. */
export const MAX_CHECKLIST_ITEMS = 500;

/** Titles and milestone names are cut to this many characters (a warning says so). */
export const MAX_CHECKLIST_TITLE = 250;

export interface ChecklistOptions {
  /** When true, a markdown heading names a milestone and the items under it belong to it. */
  headingsAsMilestones?: boolean;
}

export interface ChecklistItem {
  /** The line's text without the label tags and without `**` bold marks. */
  title: string;
  /** `- [x]` and `- [X]` are closed; `- [ ]` is open. */
  closed: boolean;
  /** Every `#word` of the line, lower case, in order, without the `#`. No duplicates. */
  labels: string[];
  /** The indented bullets under the item, markdown kept, one level of indent removed. */
  description: string;
  /** The heading the item sits under, or null (headings off, or the item comes before any heading). */
  milestone: string | null;
}

export interface ChecklistResult {
  /** Milestones that hold at least one item, in order of first use. */
  milestones: string[];
  items: ChecklistItem[];
  /** Plain sentences about lines that were skipped or shortened. */
  warnings: string[];
}

export class ChecklistError extends Error {
  readonly code = "too_many_items";
  constructor(message: string) {
    super(message);
    this.name = "ChecklistError";
  }
}

const HEADING = /^ ?(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^( *)[-*+][ \t]+\[([ xX])\][ \t]+(\S.*)$/;
const BULLET = /^( *)[-*+][ \t]+(.*)$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LABEL = /(^|\s)#([A-Za-z][\w-]{1,30})\b/g;

function clip(text: string, line: number, what: string, warnings: string[]): string {
  if (text.length <= MAX_CHECKLIST_TITLE) return text;
  warnings.push(
    `Line ${line}: the ${what} is longer than ${MAX_CHECKLIST_TITLE} characters and was cut.`,
  );
  return text.slice(0, MAX_CHECKLIST_TITLE).trimEnd();
}

/** Splits `#word` tags out of a line's text. Tags inside `code spans` and glued to a word (C#, a URL anchor) stay. */
function splitLabels(text: string): { title: string; labels: string[] } {
  const masked = text.replace(/`[^`]*`/g, (span) => "\u0000".repeat(span.length));
  const cuts: { from: number; to: number }[] = [];
  const labels: string[] = [];
  for (const m of masked.matchAll(LABEL)) {
    const label = m[2]!.toLowerCase();
    if (!labels.includes(label)) labels.push(label);
    const from = m.index! + m[1]!.length;
    cuts.push({ from, to: from + 1 + m[2]!.length });
  }
  let out = text;
  for (const c of cuts.reverse()) out = out.slice(0, c.from) + out.slice(c.to);
  return { title: out.replace(/\*\*/g, "").replace(/\s+/g, " ").trim(), labels };
}

/**
 * Reads a markdown checklist.
 *
 * - `- [ ] text`, `* [ ] text` and `+ [ ] text` are open items, `- [x]` and `- [X]` closed ones.
 * - Only a top-level item (indent under 2 spaces; a tab counts as 2) starts an item.
 * - Indented bullets under an item (checkboxes too) are its description, nesting kept.
 * - Fenced code blocks are skipped whole.
 * - A heading line (`#` to `######`) names a milestone when `headingsAsMilestones` is true.
 * - More than {@link MAX_CHECKLIST_ITEMS} items throws a {@link ChecklistError}.
 */
export function parseChecklist(
  markdown: string,
  options: ChecklistOptions = {},
): ChecklistResult {
  const asMilestones = options.headingsAsMilestones === true;
  const warnings: string[] = [];
  const items: ChecklistItem[] = [];
  const milestones: string[] = [];
  const canonical = new Map<string, string>(); // lower-case heading -> first spelling
  const descriptionLines = new Map<ChecklistItem, string[]>();
  let heading: string | null = null;
  let last: ChecklistItem | null = null;
  let fence: { char: string; size: number } | null = null;

  const body = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown; // byte order mark
  const lines = body.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.replace(/\t/g, "  ");

    const f = FENCE.exec(line);
    if (fence) {
      if (
        f &&
        f[1]![0] === fence.char &&
        f[1]!.length >= fence.size &&
        line.trim() === f[1]
      )
        fence = null;
      return;
    }
    if (f) {
      fence = { char: f[1]![0]!, size: f[1]!.length };
      if (!line.startsWith("  ")) last = null;
      return;
    }
    if (!line.trim()) return;

    const h = HEADING.exec(line);
    if (h) {
      last = null;
      if (!asMilestones) return;
      const name = clip(
        h[2]!.replace(/\*\*/g, "").replace(/\s+/g, " ").trim(),
        n,
        "heading",
        warnings,
      );
      if (!name) return;
      const key = name.toLowerCase();
      if (!canonical.has(key)) canonical.set(key, name);
      heading = canonical.get(key)!;
      return;
    }

    const indent = /^ */.exec(line)![0].length;
    const item = ITEM.exec(line);
    if (item && indent < 2) {
      const { title, labels } = splitLabels(item[3]!);
      if (!title) {
        warnings.push(
          `Line ${n}: "${line.trim()}" has no title once its labels are taken out, so it was skipped.`,
        );
        last = null;
        return;
      }
      if (items.length >= MAX_CHECKLIST_ITEMS) {
        throw new ChecklistError(
          `That is more than ${MAX_CHECKLIST_ITEMS} items. Split the import into smaller lists.`,
        );
      }
      const milestone = asMilestones ? heading : null;
      if (milestone && !milestones.includes(milestone)) milestones.push(milestone);
      last = {
        title: clip(title, n, "title", warnings),
        closed: item[2] !== " ",
        labels,
        description: "",
        milestone,
      };
      items.push(last);
      descriptionLines.set(last, []);
      return;
    }

    if (indent >= 2) {
      if (!BULLET.test(line)) return; // prose under an item is not read
      if (last) descriptionLines.get(last)!.push(line.trimEnd());
      else
        warnings.push(
          `Line ${n}: an indented bullet with no checklist item above it was ignored.`,
        );
      return;
    }

    last = null; // a paragraph or a plain bullet ends the item
  });

  for (const [item, rows] of descriptionLines) {
    if (!rows.length) continue;
    const cut = Math.min(...rows.map((r) => /^ */.exec(r)![0].length));
    item.description = rows.map((r) => r.slice(cut)).join("\n");
  }
  if (!items.length) {
    warnings.push(
      "No checklist items found. Use lines like '- [ ] Build the login page'.",
    );
  }
  return { milestones, items, warnings };
}
