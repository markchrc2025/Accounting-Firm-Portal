// markdown.ts - descriptions and comments as sanitised markdown (PB1). `marked` turns the text
// into HTML, DOMPurify removes everything that could run (scripts, event handlers, unsafe
// addresses, forms, styles), and nothing the text contains is ever executed. Images are never
// loaded: an image in the text shows as a link. Issue keys such as PAY-12 become links to that
// issue, but only the keys the API says exist; the page asks (findIssueKeys) and links those
// (linkIssueKeys). Pure functions of text, so they are tested without a screen.

import DOMPurify from "dompurify";
import { Marked } from "marked";
import { issuePath, projectKeyOf } from "./projects";

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const marked = new Marked({ gfm: true, breaks: true });
marked.use({
  renderer: {
    // An image would be fetched from wherever the text says; show it as a link instead.
    image({ href, text }: { href: string; text: string }) {
      return `<a href="${escapeHtml(href)}">${escapeHtml(text || href)}</a>`;
    },
  },
});

/** Sanitised HTML for a markdown text. Raw HTML in the text is not executed. */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text ?? "", { async: false }) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "img", "form", "iframe", "object", "embed", "svg", "math"],
    FORBID_ATTR: ["style", "srcset"],
  });
}

/** An issue key inside running text. */
const KEY_IN_TEXT = /\b([A-Z][A-Z0-9]{1,9}-\d{1,7})\b/g;
const SKIP = new Set(["A", "CODE", "PRE", "SCRIPT", "STYLE"]);

function bodyOf(html: string): HTMLElement {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
}

/** The text nodes that may hold a link: not inside a link, code or a code block. */
function linkableTextNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walk = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) out.push(c as Text);
      else if (c.nodeType === Node.ELEMENT_NODE && !SKIP.has((c as Element).tagName))
        walk(c);
    }
  };
  walk(root);
  return out;
}

/** The issue keys written in the (sanitised) HTML's plain text, once each, in order. */
export function findIssueKeys(html: string): string[] {
  const seen = new Set<string>();
  for (const t of linkableTextNodes(bodyOf(html))) {
    for (const m of (t.textContent ?? "").matchAll(KEY_IN_TEXT)) seen.add(m[1]!);
  }
  return [...seen];
}

/**
 * The HTML with every key that `exists` made a link to its issue. A key that does not exist,
 * and any key in code, stays plain text. Links to elsewhere open in a new tab and carry no
 * opener.
 */
export function linkIssueKeys(html: string, exists: (key: string) => boolean): string {
  const root = bodyOf(html);
  for (const t of linkableTextNodes(root)) {
    const text = t.textContent ?? "";
    const parts: (string | { key: string })[] = [];
    let last = 0;
    for (const m of text.matchAll(KEY_IN_TEXT)) {
      if (!exists(m[1]!)) continue;
      if (m.index! > last) parts.push(text.slice(last, m.index));
      parts.push({ key: m[1]! });
      last = m.index! + m[0].length;
    }
    if (parts.length === 0) continue;
    if (last < text.length) parts.push(text.slice(last));
    const frag = root.ownerDocument.createDocumentFragment();
    for (const p of parts) {
      if (typeof p === "string") {
        frag.appendChild(root.ownerDocument.createTextNode(p));
      } else {
        const a = root.ownerDocument.createElement("a");
        a.setAttribute("href", issuePath(projectKeyOf(p.key), p.key));
        a.setAttribute("data-issue-key", p.key);
        a.textContent = p.key;
        frag.appendChild(a);
      }
    }
    t.parentNode!.replaceChild(frag, t);
  }
  for (const a of Array.from(root.querySelectorAll("a[href]"))) {
    if (!a.hasAttribute("data-issue-key")) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  }
  return root.innerHTML;
}
