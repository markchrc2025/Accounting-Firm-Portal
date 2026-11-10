// PB1: markdown that is safe to show. Nothing in a text may run; issue keys become links only
// when they exist. All text here is invented.
import { describe, expect, it } from "vitest";
import { findIssueKeys, linkIssueKeys, renderMarkdown } from "./markdown";

const html = (md: string) => renderMarkdown(md);
const dom = (s: string) =>
  new DOMParser().parseFromString(`<body>${s}</body>`, "text/html").body;

describe("PB1 markdown is sanitised", () => {
  it("renders the usual markdown", () => {
    const out = html(
      "# Title\n\nSome **bold** and *italic* and `code`.\n\n- one\n- two\n\n1. first\n2. second",
    );
    const d = dom(out);
    expect(d.querySelector("h1")?.textContent).toBe("Title");
    expect(d.querySelector("strong")?.textContent).toBe("bold");
    expect(d.querySelector("em")?.textContent).toBe("italic");
    expect(d.querySelector("code")?.textContent).toBe("code");
    expect(d.querySelectorAll("ul li")).toHaveLength(2);
    expect(d.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("renders GitHub style tables, strikethrough and task lists", () => {
    const d = dom(
      html("| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~\n\n- [x] done\n- [ ] todo"),
    );
    expect(d.querySelectorAll("table td")).toHaveLength(2);
    expect(d.querySelector("del")?.textContent).toBe("gone");
    const boxes = [...d.querySelectorAll("input[type=checkbox]")] as HTMLInputElement[];
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => b.disabled)).toBe(true);
  });

  it("a script tag is removed, not run", () => {
    const out = html(
      "Hello <script>window.__pwned = 1</script> world\n\n<script src='https://evil.example/x.js'></script>",
    );
    expect(out.toLowerCase()).not.toContain("<script");
    expect(out).not.toContain("__pwned");
    expect(dom(out).textContent).toContain("Hello");
  });

  it("event handlers and unsafe tags are removed", () => {
    const out = html(
      '<img src=x onerror="window.__x=1"> <a href="#" onclick="window.__x=1">x</a> <iframe src="https://e.example"></iframe> <form action="https://e.example"><input name=a></form> <svg onload="window.__x=1"></svg> <style>body{display:none}</style>',
    );
    const d = dom(out);
    expect(d.querySelector("img")).toBeNull();
    expect(d.querySelector("iframe")).toBeNull();
    expect(d.querySelector("form")).toBeNull();
    expect(d.querySelector("svg")).toBeNull();
    expect(d.querySelector("style")).toBeNull();
    expect(out.toLowerCase()).not.toContain("onerror");
    expect(out.toLowerCase()).not.toContain("onclick");
    expect(out.toLowerCase()).not.toContain("onload");
  });

  it("a javascript: address is removed from a link", () => {
    const d = dom(
      html("[click](javascript:window.__x=1) and [fine](https://example.test/a)"),
    );
    const links = [...d.querySelectorAll("a")];
    expect(links.find((a) => a.textContent === "click")?.getAttribute("href")).toBeNull();
    expect(links.find((a) => a.textContent === "fine")?.getAttribute("href")).toBe(
      "https://example.test/a",
    );
  });

  it("an image is never loaded: it shows as a link to where it points", () => {
    const d = dom(html("![a diagram](https://example.test/d.png)"));
    expect(d.querySelector("img")).toBeNull();
    const a = d.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.test/d.png");
    expect(a.textContent).toBe("a diagram");
  });

  it("an empty text is an empty result", () => {
    expect(html("")).toBe("");
  });
});

describe("PB1 issue keys in text", () => {
  it("finds each key once, in order, in plain text only", () => {
    const h = html(
      "See PAY-12 and BKS-3, then PAY-12 again. `PAY-99` and\n\n```\nBKS-7\n```\n\n[PAY-55](https://example.test)",
    );
    expect(findIssueKeys(h)).toEqual(["PAY-12", "BKS-3"]);
  });

  it("does not take part of a longer word for a key", () => {
    expect(findIssueKeys(html("xPAY-12 and PAY-1234567890 and pay-12"))).toEqual([]);
  });

  it("links only the keys that exist", () => {
    const h = html("PAY-12 is done, PAY-13 does not exist.");
    const out = linkIssueKeys(h, (k) => k === "PAY-12");
    const d = dom(out);
    const links = [...d.querySelectorAll("a[data-issue-key]")];
    expect(links.map((a) => a.getAttribute("data-issue-key"))).toEqual(["PAY-12"]);
    expect(links[0]!.getAttribute("href")).toBe("/projects/PAY/issues/PAY-12");
    expect(links[0]!.textContent).toBe("PAY-12");
    expect(d.textContent?.trim()).toBe("PAY-12 is done, PAY-13 does not exist.");
  });

  it("never links a key inside code or inside a link", () => {
    const h = html("`PAY-12`\n\n```\nPAY-12\n```\n\n[PAY-12](https://example.test)");
    const out = linkIssueKeys(h, () => true);
    expect(dom(out).querySelectorAll("a[data-issue-key]")).toHaveLength(0);
  });

  it("links more than one key in one line and keeps the text between them", () => {
    const out = linkIssueKeys(html("Blocked by PAY-1 and PAY-2, see BKS-9."), () => true);
    const d = dom(out);
    expect(d.querySelectorAll("a[data-issue-key]")).toHaveLength(3);
    expect(d.textContent?.trim()).toBe("Blocked by PAY-1 and PAY-2, see BKS-9.");
  });

  it("a link elsewhere opens in a new tab with no opener; a key link stays in the Portal", () => {
    const out = linkIssueKeys(
      html("[out](https://example.test/x) PAY-1"),
      (k) => k === "PAY-1",
    );
    const d = dom(out);
    const ext = d.querySelector('a[href^="https://"]')!;
    expect(ext.getAttribute("target")).toBe("_blank");
    expect(ext.getAttribute("rel")).toBe("noopener noreferrer");
    const inner = d.querySelector("a[data-issue-key]")!;
    expect(inner.getAttribute("target")).toBeNull();
  });

  it("text that looks like HTML inside a key line stays text", () => {
    const out = linkIssueKeys(html("PAY-1 &lt;b&gt;not bold&lt;/b&gt;"), () => true);
    expect(dom(out).querySelector("b")).toBeNull();
  });
});
