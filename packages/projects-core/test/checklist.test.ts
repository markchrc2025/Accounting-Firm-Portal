import { describe, expect, it } from "vitest";
import { ChecklistError, MAX_CHECKLIST_ITEMS, parseChecklist } from "../src";

const on = { headingsAsMilestones: true };

describe("parseChecklist: items", () => {
  it("reads open and closed items", () => {
    const r = parseChecklist(
      "- [ ] Build the login page\n- [x] Set up the repo\n- [X] Pick a name",
    );
    expect(r.items.map((i) => [i.title, i.closed])).toEqual([
      ["Build the login page", false],
      ["Set up the repo", true],
      ["Pick a name", true],
    ]);
    expect(r.milestones).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("accepts -, * and + bullets and CRLF line ends", () => {
    const r = parseChecklist("* [ ] One\r\n+ [x] Two\r\n- [ ] Three\r\n");
    expect(r.items.map((i) => i.title)).toEqual(["One", "Two", "Three"]);
    expect(r.items.map((i) => i.closed)).toEqual([false, true, false]);
  });

  it("ignores a byte order mark, blank lines, prose and plain bullets", () => {
    const r = parseChecklist(
      `${String.fromCharCode(0xfeff)}Some intro text.\n\n- plain bullet\n- [ ] Real item\n\nMore prose.\n`,
    );
    expect(r.items.map((i) => i.title)).toEqual(["Real item"]);
    expect(r.warnings).toEqual([]);
  });

  it("does not read a checkbox without text or without a space after the bracket", () => {
    const r = parseChecklist("- [ ]\n- [ ]x\n- [] none\n- [y] odd\n- [ ] ok");
    expect(r.items.map((i) => i.title)).toEqual(["ok"]);
  });

  it("returns a warning, not an error, when there is nothing to import", () => {
    const r = parseChecklist("just words");
    expect(r.items).toEqual([]);
    expect(r.warnings).toEqual([
      "No checklist items found. Use lines like '- [ ] Build the login page'.",
    ]);
    expect(parseChecklist("").items).toEqual([]);
  });

  it("strips ** bold marks from the title and keeps other markdown", () => {
    const r = parseChecklist(
      "- [ ] **Login** page with `code` and [a link](https://example.test/x)",
    );
    expect(r.items[0]!.title).toBe(
      "Login page with `code` and [a link](https://example.test/x)",
    );
  });

  it("treats a tab as two spaces of indent", () => {
    const r = parseChecklist("- [ ] Parent\n\t- child\n- [ ] Next");
    expect(r.items).toHaveLength(2);
    expect(r.items[0]!.description).toBe("- child");
  });
});

describe("parseChecklist: labels", () => {
  it("takes #words from the end, the middle and the start of a line", () => {
    const r = parseChecklist(
      [
        "- [ ] Fix the crash #bug #urgent",
        "- [ ] Add #ui polish to the form",
        "- [ ] #backend Rate limit the API",
      ].join("\n"),
    );
    expect(r.items.map((i) => [i.title, i.labels])).toEqual([
      ["Fix the crash", ["bug", "urgent"]],
      ["Add polish to the form", ["ui"]],
      ["Rate limit the API", ["backend"]],
    ]);
  });

  it("lower-cases labels, keeps hyphens and underscores, drops duplicates", () => {
    const r = parseChecklist("- [ ] Task #Needs-Review #needs-review #tech_debt");
    expect(r.items[0]!.labels).toEqual(["needs-review", "tech_debt"]);
    expect(r.items[0]!.title).toBe("Task");
  });

  it("does not take a hash glued to a word, a number, a URL anchor or a code span", () => {
    const r = parseChecklist(
      "- [ ] Port to C# and F#\n- [ ] See PR #123 and #9x\n- [ ] Read https://example.test/page#top\n- [ ] Use `#define` and `a #tag b` here",
    );
    expect(r.items.map((i) => i.labels)).toEqual([[], [], [], []]);
    expect(r.items[0]!.title).toBe("Port to C# and F#");
    expect(r.items[3]!.title).toBe("Use `#define` and `a #tag b` here");
  });

  it("needs a letter first and 2 to 31 characters", () => {
    const r = parseChecklist(
      `- [ ] A #a B #ab C #${"x".repeat(31)} D #${"y".repeat(32)}`,
    );
    expect(r.items[0]!.labels).toEqual(["ab", "x".repeat(31)]);
    expect(r.items[0]!.title).toBe(`A #a B C D #${"y".repeat(32)}`);
  });

  it("closes the gap a label leaves", () => {
    expect(parseChecklist("- [ ] one  #xy  two").items[0]!.title).toBe("one two");
  });

  it("skips an item that is nothing but labels, with a warning", () => {
    const r = parseChecklist("- [ ] #bug #ui\n- [ ] Kept");
    expect(r.items.map((i) => i.title)).toEqual(["Kept"]);
    expect(r.warnings).toEqual([
      'Line 1: "- [ ] #bug #ui" has no title once its labels are taken out, so it was skipped.',
    ]);
  });

  it("cuts a title over 250 characters and says so", () => {
    const r = parseChecklist(`- [ ] ${"w".repeat(300)}`);
    expect(r.items[0]!.title).toBe("w".repeat(250));
    expect(r.warnings).toEqual([
      "Line 1: the title is longer than 250 characters and was cut.",
    ]);
  });
});

describe("parseChecklist: descriptions", () => {
  it("makes indented bullets the description and keeps their markdown and nesting", () => {
    const r = parseChecklist(
      [
        "- [ ] Build login",
        "  - Email field with **validation**",
        "    - must match `^.+@.+$`",
        "  - [x] Password field",
        "  - [ ] Forgot link [docs](https://example.test)",
        "- [ ] Next",
        "  * second item note",
      ].join("\n"),
    );
    expect(r.items[0]!.description).toBe(
      [
        "- Email field with **validation**",
        "  - must match `^.+@.+$`",
        "- [x] Password field",
        "- [ ] Forgot link [docs](https://example.test)",
      ].join("\n"),
    );
    expect(r.items[1]!.description).toBe("* second item note");
    expect(r.items).toHaveLength(2);
  });

  it("removes only the indent the whole block shares", () => {
    const r = parseChecklist(
      "- [ ] A\n    - deep first\n      - deeper\n    - deep second",
    );
    expect(r.items[0]!.description).toBe("- deep first\n  - deeper\n- deep second");
  });

  it("keeps blank lines between an item and its bullets from ending it", () => {
    const r = parseChecklist("- [ ] A\n\n  - note after a blank line");
    expect(r.items[0]!.description).toBe("- note after a blank line");
  });

  it("ends an item at a paragraph or a plain top-level bullet and warns about orphans", () => {
    const r = parseChecklist(
      "- [ ] A\nA paragraph.\n  - orphan one\n- [ ] B\n- plain\n  - orphan two",
    );
    expect(r.items.map((i) => i.description)).toEqual(["", ""]);
    expect(r.warnings).toEqual([
      "Line 3: an indented bullet with no checklist item above it was ignored.",
      "Line 6: an indented bullet with no checklist item above it was ignored.",
    ]);
  });

  it("does not read prose under an item", () => {
    const r = parseChecklist("- [ ] A\n  just a sentence\n  - bullet");
    expect(r.items[0]!.description).toBe("- bullet");
  });

  it("is empty for an item with no bullets", () => {
    expect(parseChecklist("- [ ] A").items[0]!.description).toBe("");
  });
});

describe("parseChecklist: headings and milestones", () => {
  const doc = [
    "- [ ] Before any heading",
    "# Release 1",
    "- [ ] One",
    "## Release 2 ##",
    "- [x] Two",
    "- [ ] Three",
    "### Release 1",
    "- [ ] Four, back under the first name",
    "#### Empty section",
    "##### Five hashes",
    "###### Six hashes",
    "- [ ] Under six",
  ].join("\n");

  it("turns headings into milestones when asked, in order of first use", () => {
    const r = parseChecklist(doc, on);
    expect(r.milestones).toEqual(["Release 1", "Release 2", "Six hashes"]);
    expect(r.items.map((i) => [i.title, i.milestone])).toEqual([
      ["Before any heading", null],
      ["One", "Release 1"],
      ["Two", "Release 2"],
      ["Three", "Release 2"],
      ["Four, back under the first name", "Release 1"],
      ["Under six", "Six hashes"],
    ]);
  });

  it("ignores headings when off, which is also the default", () => {
    for (const r of [
      parseChecklist(doc, { headingsAsMilestones: false }),
      parseChecklist(doc),
      parseChecklist(doc, {}),
    ]) {
      expect(r.milestones).toEqual([]);
      expect(r.items).toHaveLength(6);
      expect(r.items.every((i) => i.milestone === null)).toBe(true);
    }
  });

  it("matches headings that differ only in case and keeps the first spelling", () => {
    const r = parseChecklist("# Sprint One\n- [ ] a\n# SPRINT ONE\n- [ ] b", on);
    expect(r.milestones).toEqual(["Sprint One"]);
    expect(r.items.map((i) => i.milestone)).toEqual(["Sprint One", "Sprint One"]);
  });

  it("strips bold marks and a closing run of hashes, keeps a hash that ends a word", () => {
    const r = parseChecklist("## **Phase 2** ##\n- [ ] a\n## Learn C#\n- [ ] b", on);
    expect(r.milestones).toEqual(["Phase 2", "Learn C#"]);
  });

  it("does not read a hash without a space, or an item line, as a heading", () => {
    const r = parseChecklist("#hashtag\n- [ ] #label only text", on);
    expect(r.milestones).toEqual([]);
  });

  it("ends the previous item's description at a heading", () => {
    const r = parseChecklist("- [ ] A\n# H\n  - orphan", on);
    expect(r.items[0]!.description).toBe("");
    expect(r.warnings).toHaveLength(1);
  });

  it("cuts a very long heading and says so", () => {
    const r = parseChecklist(`# ${"h".repeat(260)}\n- [ ] a`, on);
    expect(r.milestones[0]).toBe("h".repeat(250));
    expect(r.warnings).toEqual([
      "Line 1: the heading is longer than 250 characters and was cut.",
    ]);
  });
});

describe("parseChecklist: fenced code", () => {
  it("skips items and headings inside a fence and resumes after it", () => {
    const r = parseChecklist(
      [
        "# Real",
        "- [ ] Before",
        "```md",
        "# Not a heading",
        "- [ ] Not an item",
        "```",
        "- [ ] After",
        "~~~",
        "- [ ] tilde",
        "~~~",
      ].join("\n"),
      on,
    );
    expect(r.items.map((i) => i.title)).toEqual(["Before", "After"]);
    expect(r.milestones).toEqual(["Real"]);
  });

  it("closes a fence only with the same character and at least as many marks", () => {
    const r = parseChecklist("````\n```\n- [ ] still inside\n````\n- [ ] out");
    expect(r.items.map((i) => i.title)).toEqual(["out"]);
  });

  it("treats an unclosed fence as running to the end", () => {
    expect(parseChecklist("- [ ] a\n```\n- [ ] b").items.map((i) => i.title)).toEqual([
      "a",
    ]);
  });
});

describe("parseChecklist: the 500 item limit", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => `- [ ] Item ${i + 1}`).join("\n");

  it("accepts exactly 500 items", () => {
    expect(MAX_CHECKLIST_ITEMS).toBe(500);
    const r = parseChecklist(many(500));
    expect(r.items).toHaveLength(500);
    expect(r.items[499]!.title).toBe("Item 500");
  });

  it("refuses 501 items with a sentence", () => {
    expect(() => parseChecklist(many(501))).toThrow(ChecklistError);
    expect(() => parseChecklist(many(501))).toThrow(
      "That is more than 500 items. Split the import into smaller lists.",
    );
    expect(() => parseChecklist(many(501), on)).toThrow(/more than 500 items/);
  });

  it("counts items, not lines: sub-bullets and skipped lines do not count", () => {
    const withBullets = Array.from(
      { length: 500 },
      (_, i) => `- [ ] I${i}\n  - note\n- plain\nprose`,
    ).join("\n");
    expect(parseChecklist(withBullets).items).toHaveLength(500);
    expect(parseChecklist(`${many(500)}\n- [ ] #onlylabel`).items).toHaveLength(500);
  });

  it("does not count items inside fenced code", () => {
    expect(parseChecklist(`${many(500)}\n\`\`\`\n${many(5)}\n\`\`\``).items).toHaveLength(
      500,
    );
  });
});
