import { describe, expect, it } from "vitest";
import {
  CLOSING_KEYWORDS,
  LOOKALIKE_PREFIXES,
  closingKeys,
  extractIssueKeys,
} from "../src";

describe("extractIssueKeys: where keys appear", () => {
  it("finds a key in a branch name", () => {
    expect(extractIssueKeys("feature/PAY-12-add-login")).toEqual(["PAY-12"]);
    expect(extractIssueKeys("bugfix/BKS-7")).toEqual(["BKS-7"]);
    expect(extractIssueKeys("PAY-12-login")).toEqual(["PAY-12"]);
    expect(extractIssueKeys("feature-PAY-12-login")).toEqual(["PAY-12"]);
  });

  it("finds keys in a commit message at line start, middle and end", () => {
    expect(extractIssueKeys("PAY-1 add login")).toEqual(["PAY-1"]);
    expect(extractIssueKeys("add login for PAY-2 today")).toEqual(["PAY-2"]);
    expect(extractIssueKeys("add login (PAY-3)")).toEqual(["PAY-3"]);
    expect(extractIssueKeys("add login PAY-4")).toEqual(["PAY-4"]);
    expect(extractIssueKeys("add login.\n\nRefs: PAY-5\nand BKS-6!")).toEqual([
      "PAY-5",
      "BKS-6",
    ]);
  });

  it("finds keys in a pull request body, with markdown around them", () => {
    const body = [
      "## Summary",
      "",
      "- Adds the form (**PAY-10**)",
      "- Follow-up in `PAY-11`",
      "- See [PAY-12](https://example.test/x)",
      "",
      "Fixes PAY-10, PAY-13.",
    ].join("\n");
    expect(extractIssueKeys(body)).toEqual(["PAY-10", "PAY-11", "PAY-12", "PAY-13"]);
  });

  it("returns each key once, in order of first appearance", () => {
    expect(extractIssueKeys("BKS-2 PAY-9 BKS-2 PAY-1 PAY-9")).toEqual([
      "BKS-2",
      "PAY-9",
      "PAY-1",
    ]);
  });

  it("returns nothing for empty text or text without keys", () => {
    expect(extractIssueKeys("")).toEqual([]);
    expect(extractIssueKeys("nothing to see here, version 1.2.3")).toEqual([]);
  });
});

describe("extractIssueKeys: the shape of a key", () => {
  it("takes 2 to 10 capitals or digits, starting with a letter", () => {
    expect(extractIssueKeys("AB-1 A1-2 AB2-3 ABCDEFGHIJ-4")).toEqual([
      "AB-1",
      "A1-2",
      "AB2-3",
      "ABCDEFGHIJ-4",
    ]);
    expect(extractIssueKeys("A-1 1A-2 12-3 ABCDEFGHIJK-4")).toEqual([]);
  });

  it("takes numbers from 1 to 7 digits with no leading zero", () => {
    expect(extractIssueKeys("PAY-1 PAY-1234567")).toEqual(["PAY-1", "PAY-1234567"]);
    expect(extractIssueKeys("PAY-0 PAY-007 PAY-12345678")).toEqual([]);
  });

  it("does not read a key in lower or mixed case by default", () => {
    expect(extractIssueKeys("feature/pay-12-login fixes Pay-3 explain-3 utf-8")).toEqual(
      [],
    );
  });

  it("reads lower and mixed case, returned in capitals, when ignoreCase is on", () => {
    expect(
      extractIssueKeys("feature/pay-12-login and Bks-3 and PAY-12", { ignoreCase: true }),
    ).toEqual(["PAY-12", "BKS-3"]);
    expect(extractIssueKeys("bugfix-pay-12", { ignoreCase: true })).toEqual(["PAY-12"]);
  });
});

describe("extractIssueKeys: not a key", () => {
  it("skips a key inside a longer word or number", () => {
    expect(extractIssueKeys("xPAY-12 PAY-12x PAY-12_a _PAY-12 PAY-1a 9PAY-1")).toEqual(
      [],
    );
    expect(extractIssueKeys("9pay-1 _pay-1 pay-1x", { ignoreCase: true })).toEqual([]);
  });

  it("skips a longer number, a version, a file name and an address", () => {
    expect(
      extractIssueKeys(
        "CVE-2024-1234 ABC-12-34 ABC-1.5 PAY-12.md PAY-12.example.com ABC-12@mail.test x@ABC-12.test",
      ),
    ).toEqual([]);
  });

  it("keeps a key at the end of a sentence and before a hyphenated word", () => {
    expect(
      extractIssueKeys("Done with PAY-12. Next PAY-13, then PAY-14; PAY-15: ok PAY-16-x"),
    ).toEqual(["PAY-12", "PAY-13", "PAY-14", "PAY-15", "PAY-16"]);
  });

  it("skips a name made of hyphenated capitals", () => {
    expect(extractIssueKeys("ISO-IEC-27001 and TLS-ECDHE-RSA-128 and X-AB-12")).toEqual(
      [],
    );
  });

  it("skips look-alike standards names unless the project key list says they are real", () => {
    const text = "UTF-8 SHA-256 ISO-8601 COVID-19 CWE-79 RFC-2119 UTC-8 MD-5 PAY-12";
    expect(extractIssueKeys(text)).toEqual(["PAY-12"]);
    expect(extractIssueKeys(text, { projectKeys: ["pay", "ISO"] })).toEqual([
      "ISO-8601",
      "PAY-12",
    ]);
    expect(LOOKALIKE_PREFIXES).toContain("COVID");
  });

  it("with a project key list, returns only those projects' keys", () => {
    expect(
      extractIssueKeys("PAY-1 BKS-2 POS-3", { projectKeys: ["BKS", "POS"] }),
    ).toEqual(["BKS-2", "POS-3"]);
    expect(
      extractIssueKeys("pay-1 bks-2", { projectKeys: ["BKS"], ignoreCase: true }),
    ).toEqual(["BKS-2"]);
    expect(extractIssueKeys("PAY-1", { projectKeys: [] })).toEqual([]);
  });
});

describe("extractIssueKeys: links", () => {
  it("keeps a key that is a whole path segment of a link", () => {
    expect(
      extractIssueKeys("see https://tracker.example.test/browse/PAY-12 now"),
    ).toEqual(["PAY-12"]);
    expect(
      extractIssueKeys("(https://tracker.example.test/issue/PAY-12/title-slug)"),
    ).toEqual(["PAY-12"]);
    expect(
      extractIssueKeys("https://tracker.example.test/browse/PAY-12?focus=1"),
    ).toEqual(["PAY-12"]);
    expect(extractIssueKeys("https://tracker.example.test/browse/PAY-12#top")).toEqual([
      "PAY-12",
    ]);
    expect(extractIssueKeys("Link: https://tracker.example.test/browse/PAY-12.")).toEqual(
      ["PAY-12"],
    );
  });

  it("skips a key that is part of a path segment, a host, a query or a fragment", () => {
    expect(extractIssueKeys("https://example.test/files/PAY-12.pdf")).toEqual([]);
    expect(extractIssueKeys("https://example.test/PAY-12-some-slug")).toEqual([]);
    expect(extractIssueKeys("https://PAY-12.example.test/x")).toEqual([]);
    expect(extractIssueKeys("https://example.test/search?ref=PAY-12")).toEqual([]);
    expect(extractIssueKeys("https://example.test/page#PAY-12")).toEqual([]);
    expect(extractIssueKeys("www.example.test/a/xPAY-12")).toEqual([]);
  });

  it("still finds keys outside the link in the same text", () => {
    expect(
      extractIssueKeys(
        "BKS-1 https://example.test/docs/UTF-8/ PAY-2 https://example.test/files/ABC-3.zip",
      ),
    ).toEqual(["BKS-1", "PAY-2"]);
  });
});

describe("closingKeys", () => {
  it("lists the nine words GitHub closes on", () => {
    expect(CLOSING_KEYWORDS).toEqual([
      "close",
      "closes",
      "closed",
      "fix",
      "fixes",
      "fixed",
      "resolve",
      "resolves",
      "resolved",
    ]);
  });

  it("closes on each of the nine words, in any case", () => {
    for (const word of [
      "close",
      "closes",
      "closed",
      "fix",
      "fixes",
      "fixed",
      "resolve",
      "resolves",
      "resolved",
      "Fixes",
      "CLOSES",
      "rEsOlVeD",
    ]) {
      expect(closingKeys(`${word} PAY-1`)).toEqual(["PAY-1"]);
    }
  });

  it("allows an optional colon and spaces after it", () => {
    expect(closingKeys("Fixes: PAY-1")).toEqual(["PAY-1"]);
    expect(closingKeys("fixes:PAY-1")).toEqual(["PAY-1"]);
    expect(closingKeys("Closes:   PAY-1")).toEqual(["PAY-1"]);
    expect(closingKeys("fixes\tPAY-1")).toEqual(["PAY-1"]);
  });

  it("finds the keyword anywhere in the text", () => {
    expect(closingKeys("Add login.\n\nCloses PAY-1\nRefs PAY-2")).toEqual(["PAY-1"]);
    expect(closingKeys("This (fixes PAY-3) and, once done, resolves BKS-4.")).toEqual([
      "PAY-3",
      "BKS-4",
    ]);
  });

  it("reads a list after one keyword: commas, and, ampersand, spaces", () => {
    expect(closingKeys("fixes PAY-1, PAY-2 and PAY-3")).toEqual([
      "PAY-1",
      "PAY-2",
      "PAY-3",
    ]);
    expect(closingKeys("closes PAY-1,PAY-2, and PAY-3")).toEqual([
      "PAY-1",
      "PAY-2",
      "PAY-3",
    ]);
    expect(closingKeys("resolves PAY-1 & PAY-2")).toEqual(["PAY-1", "PAY-2"]);
    expect(closingKeys("fixes PAY-1 PAY-2")).toEqual(["PAY-1", "PAY-2"]);
    expect(closingKeys("Fixes PAY-1, fixes PAY-2")).toEqual(["PAY-1", "PAY-2"]);
  });

  it("ends the list at a full stop, a new line or another word", () => {
    expect(closingKeys("Fixes PAY-1. PAY-2 is related")).toEqual(["PAY-1"]);
    expect(closingKeys("Fixes PAY-1\nPAY-2 is related")).toEqual(["PAY-1"]);
    expect(closingKeys("Fixes PAY-1 and also PAY-2")).toEqual(["PAY-1"]);
    expect(closingKeys("Fixes PAY-1; see PAY-2")).toEqual(["PAY-1"]);
  });

  it("does not close on a key that only appears elsewhere", () => {
    expect(closingKeys("Refs PAY-1, relates to PAY-2, see PAY-3")).toEqual([]);
    expect(closingKeys("PAY-1 fixes the crash")).toEqual([]);
  });

  it("needs the keyword to stand alone and the key to follow on the same line", () => {
    expect(
      closingKeys(
        "prefixes PAY-1, unresolved PAY-2, enclosed PAY-3, fixing PAY-4, bugfix PAY-5",
      ),
    ).toEqual([]);
    expect(closingKeys("Fixes\nPAY-1")).toEqual([]);
    expect(closingKeys("Fixes")).toEqual([]);
    expect(closingKeys("Fixes #12")).toEqual([]);
  });

  it("applies the key rules: case, links, look-alikes, project list", () => {
    expect(closingKeys("fixes pay-1")).toEqual([]);
    expect(closingKeys("fixes pay-1", { ignoreCase: true })).toEqual(["PAY-1"]);
    expect(closingKeys("fixes UTF-8")).toEqual([]);
    expect(closingKeys("fixes https://example.test/browse/PAY-1")).toEqual([]);
    expect(closingKeys("fixes PAY-1, BKS-2", { projectKeys: ["BKS"] })).toEqual([]);
    expect(closingKeys("fixes BKS-2, PAY-1", { projectKeys: ["BKS"] })).toEqual([
      "BKS-2",
    ]);
  });

  it("returns each key once, in order of first appearance", () => {
    expect(closingKeys("Fixes PAY-2. Closes PAY-1, PAY-2. Resolved PAY-3")).toEqual([
      "PAY-2",
      "PAY-1",
      "PAY-3",
    ]);
  });

  it("is a subset of the keys extractIssueKeys finds", () => {
    const text = "Fixes PAY-2 and BKS-4. See PAY-9, UTF-8, CVE-2024-1.";
    const all = extractIssueKeys(text);
    for (const k of closingKeys(text)) expect(all).toContain(k);
  });
});
