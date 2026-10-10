// track-b-w10.test.ts — W10 R2: no browser dialog anywhere under apps/web/src.
// The Portal asks in the page (ConfirmDialog); a browser confirm, alert or
// prompt — called through window or bare — fails this test, with file and line.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const NAMES = ["con" + "firm", "al" + "ert", "pro" + "mpt"].join("|");
/** `window.<name>(` / `globalThis.<name>(` / `self.<name>(`, or a bare
 *  `<name>(` that is not a property, a longer identifier or a declaration. */
const CALL = new RegExp(
  `(?:\\b(?:window|globalThis|self)\\s*\\.\\s*(?:${NAMES})\\s*\\()|(?:(?<![\\w$.])(?:${NAMES})\\s*\\()`,
);
const DECLARATION = new RegExp(`\\bfunction\\s+(?:${NAMES})\\s*\\(`);

/** Every browser-dialog call under apps/web/src, as "file:line: code". */
export function browserDialogCalls(root = SRC): string[] {
  const self = resolve(__filename);
  const out: string[] = [];
  for (const file of walk(root)) {
    if (!/\.(tsx?|jsx?)$/.test(file) || resolve(file) === self) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "");
        if (CALL.test(code) && !DECLARATION.test(code)) {
          out.push(`${relative(root, file)}:${i + 1}: ${line.trim()}`);
        }
      });
  }
  return out;
}

describe("no browser dialog anywhere under apps/web/src (W10 R2)", () => {
  it("finds no window.confirm / alert / prompt, nor a bare one", () => {
    expect(browserDialogCalls()).toEqual([]);
  });

  it("the check itself sees each form it forbids", () => {
    const sample = [
      `window.${"con" + "firm"}("x")`,
      `if (!${"con" + "firm"}("x")) return;`,
      `${"al" + "ert"}("x")`,
      `window . ${"pro" + "mpt"}("x")`,
      `globalThis.${"con" + "firm"}("x")`,
    ];
    for (const s of sample) expect(CALL.test(s), s).toBe(true);
    for (const s of [
      "onConfirm()",
      "confirmMfa(code)",
      "ask.confirm(x)",
      "setAlert(x)",
    ]) {
      expect(CALL.test(s), s).toBe(false);
    }
  });
});
