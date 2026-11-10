import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AuditImportError,
  MAX_ISSUE_DESCRIPTION,
  PRIORITY_FOR_SEVERITY,
  coverageCounts,
  fingerprint,
  mapFinding,
  mapFindings,
  parseFindings,
  summariseAudit,
  type AuditRunMetadata,
  type ConfirmedFinding,
  type Finding,
  type MappedIssue,
  type NeedsValidationFinding,
  type Severity,
} from "../src";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(join(here, "fixtures", name), "utf8");
const golden = (name: string): string =>
  readFileSync(join(here, "golden", name), "utf8").replace(/\n$/, "");

/** A fresh copy of the invented findings.json (it passes the skill's validate-findings.cjs). */
const findings = (): Finding[] => JSON.parse(fixture("findings.json")) as Finding[];
const byFp = (fp: string): Finding => findings().find((f) => f.fingerprint === fp)!;
const confirmed = (fp = "api-high-missing-ownership-check"): ConfirmedFinding =>
  byFp(fp) as ConfirmedFinding;
const issue = (f: Finding): MappedIssue => {
  const m = mapFinding(f);
  if (m.kind !== "issue") throw new Error("expected an issue");
  return m;
};
const RUN: AuditRunMetadata = JSON.parse(
  fixture("run-metadata.json"),
) as AuditRunMetadata;
const LEDGER: unknown = JSON.parse(fixture("coverage-ledger.json"));

describe("mapFinding: confirmed findings become Bugs", () => {
  const table: [string, Severity, string, string][] = [
    ["api-critical-account-takeover", "critical", "sev-critical", "URGENT"],
    ["api-high-missing-ownership-check", "high", "sev-high", "HIGH"],
    ["api-medium-open-redirect", "medium", "sev-medium", "NORMAL"],
    ["api-low-verbose-error", "low", "sev-low", "LOW"],
    ["api-info-missing-header", "informational", "sev-informational", "LOW"],
  ];
  it.each(table)(
    "%s: %s gives labels, priority and a Bug",
    (fp, severity, label, priority) => {
      const m = issue(byFp(fp));
      expect(m).toMatchObject({
        kind: "issue",
        fingerprint: fp,
        type: "Bug",
        labels: ["security", label],
        priority,
        severity,
      });
      expect(m.title).toBe((byFp(fp) as ConfirmedFinding).title);
      expect(m.description.length).toBeGreaterThan(100);
    },
  );

  it("covers every severity in the priority table", () => {
    expect(PRIORITY_FOR_SEVERITY).toEqual({
      critical: "URGENT",
      high: "HIGH",
      medium: "NORMAL",
      low: "LOW",
      informational: "LOW",
    });
  });

  it("writes the description from every section the finding has (golden)", () => {
    const m = mapFinding(confirmed(), {
      runId: "sample-run-2026-11-01",
      commit: "0123456789abcdef0123456789abcdef01234567",
    }) as MappedIssue;
    expect(m.description).toBe(golden("confirmed-high.md"));
  });

  it("without a run, the first line carries the fingerprint only (golden)", () => {
    expect(issue(byFp("api-low-verbose-error")).description).toBe(
      golden("confirmed-low-no-context.md"),
    );
  });

  it("leaves out each section the finding does not have", () => {
    const f = confirmed() as Partial<ConfirmedFinding> & Record<string, unknown>;
    for (const gone of [
      "trace",
      "evidence",
      "conditions",
      "execution",
      "remediation",
      "confidence",
    ])
      delete f[gone];
    const d = issue(f as ConfirmedFinding).description;
    expect(d).toContain("### Root cause");
    for (const heading of [
      "### Trace",
      "### Evidence",
      "### Conditions",
      "### Reproduction",
      "### Fix",
    ]) {
      expect(d).not.toContain(heading);
    }
    expect(d).not.toContain("Confidence");
    expect(d).not.toMatch(/\n\n\n/);
  });

  it("writes reproduction steps from an array, or from a single string", () => {
    const f = confirmed();
    f.execution!.instructions = "Run the sample service and send the payload.";
    expect(issue(f).description).toContain(
      "Run the sample service and send the payload.",
    );
    expect(issue(f).description).not.toContain("1. ");
    f.execution!.instructions = [];
    expect(issue(f).description).not.toContain("1. ");
  });

  it("fences a payload that contains backticks with a longer fence", () => {
    const f = confirmed();
    f.execution!.payloads = ["echo ```inner``` done"];
    f.remediation!.code_changes = [{ file_name: "src/a`b.ts", fixed_code: "x" }];
    const d = issue(f).description;
    expect(d).toContain("````\necho ```inner``` done\n````");
    expect(d).toContain("`` src/a`b.ts ``");
  });

  it("lists at most 40 trace steps and says how many are left", () => {
    const f = confirmed();
    f.trace = Array.from({ length: 45 }, (_, i) => ({
      kind: "propagation",
      file: `src/f${i}.ts`,
      line: i + 1,
      scope: "s",
      description: "d",
    }));
    const d = issue(f).description;
    expect(d.match(/^- \*\*propagation\*\*/gm)).toHaveLength(40);
    expect(d).toContain("- _and 5 more_");
  });

  it("trims a title to one line of at most 250 characters", () => {
    const f = confirmed();
    f.title = `  Line one\n   line   two ${"x".repeat(400)}`;
    const t = issue(f).title;
    expect(t.startsWith("Line one line two xxx")).toBe(true);
    expect(t).toHaveLength(250);
  });

  it("cuts a description over the limit and says so", () => {
    const f = confirmed();
    f.root_cause = "r".repeat(MAX_ISSUE_DESCRIPTION + 5000);
    const d = issue(f).description;
    expect(d.length).toBeLessThanOrEqual(MAX_ISSUE_DESCRIPTION);
    expect(d.endsWith("_The rest of this finding was cut. See the audit report._")).toBe(
      true,
    );
  });

  it("refuses a confirmed finding with no valid severity", () => {
    const f = confirmed();
    (f.severity as { overall_severity: string }).overall_severity = "catastrophic";
    expect(() => mapFinding(f)).toThrow(AuditImportError);
    expect(() => mapFinding(f)).toThrow(/no valid severity\.overall_severity/);
  });

  it("refuses an unknown verdict and an empty title", () => {
    expect(() =>
      mapFinding({ ...confirmed(), verdict: "maybe" } as unknown as Finding),
    ).toThrow(/unknown verdict/);
    expect(() => mapFinding({ ...confirmed(), title: "  " })).toThrow(/has no title/);
  });
});

describe("mapFinding: needs_validation and rejected", () => {
  const nv = (): NeedsValidationFinding =>
    byFp("web-needs-sample-upload-limit") as NeedsValidationFinding;

  it("makes a Task with security and needs-validation, and no severity label", () => {
    const m = issue(nv());
    expect(m).toMatchObject({
      type: "Task",
      labels: ["security", "needs-validation"],
      priority: "NORMAL",
      severity: null,
      fingerprint: "web-needs-sample-upload-limit",
    });
    expect(m.labels.some((l) => l.startsWith("sev-"))).toBe(false);
  });

  it("writes the lead's description (golden)", () => {
    const m = mapFinding(nv(), {
      runId: "sample-run-2026-11-01",
      commit: "0123456789abcdef0123456789abcdef01234567",
    }) as MappedIssue;
    expect(m.description).toBe(golden("needs-validation.md"));
  });

  it("leaves out the plan and the blockers when there are none", () => {
    const f = nv() as Partial<NeedsValidationFinding> & Record<string, unknown>;
    delete f.validation_plan;
    delete f.blockers;
    const d = issue(f as NeedsValidationFinding).description;
    expect(d).not.toContain("### Blockers");
    expect(d).not.toContain("### How to resolve");
    expect(d).toContain("**Needs validation.**");
  });

  it("lists only the plan step that exists", () => {
    const f = nv();
    f.validation_plan = { deployment: "Ask the owner." };
    const d = issue(f).description;
    expect(d).toContain("- Check on the deployment: Ask the owner.");
    expect(d).not.toContain("Local check");
  });

  it("returns a rejected finding separately, with its reason, and no issue", () => {
    const m = mapFinding(byFp("web-rejected-sample-xss"));
    expect(m).toEqual({
      kind: "rejected",
      fingerprint: "web-rejected-sample-xss",
      title: "Sample comment field may allow script injection",
      reason:
        "The framework escapes the value, and a local run showed the script as plain text.",
    });
  });

  it("splits a whole file into issues and rejections", () => {
    const { issues, rejected } = mapFindings(findings());
    expect(issues).toHaveLength(6);
    expect(issues.filter((i) => i.type === "Bug")).toHaveLength(5);
    expect(issues.filter((i) => i.type === "Task")).toHaveLength(1);
    expect(rejected.map((r) => r.fingerprint)).toEqual(["web-rejected-sample-xss"]);
    expect(
      [...issues.map((i) => i.fingerprint), ...rejected.map((r) => r.fingerprint)].sort(),
    ).toEqual(
      findings()
        .map((f) => f.fingerprint)
        .sort(),
    );
  });
});

describe("fingerprint", () => {
  it("is the finding's own fingerprint field, unchanged", () => {
    for (const f of findings()) expect(fingerprint(f)).toBe(f.fingerprint);
  });

  it("is the same on a re-run of the same finding", () => {
    const first = mapFindings(findings()).issues.map((i) => i.fingerprint);
    const second = mapFindings(findings()).issues.map((i) => i.fingerprint);
    expect(second).toEqual(first);
  });

  it("does not change when the code moved, the wording changed or the verdict changed", () => {
    const f = confirmed();
    const before = fingerprint(f);
    f.trace = f.trace!.map((t) => ({ ...t, line: t.line + 120 }));
    f.evidence = f.evidence!.map((e) => ({ ...e, line: e.line + 120 }));
    f.title = "A reworded title";
    f.description = "A reworded description.";
    expect(fingerprint(f)).toBe(before);
    expect(mapFinding(f)).toMatchObject({ fingerprint: before });
    const asLead = {
      ...f,
      verdict: "needs_validation",
      claimed_root_cause: "c",
    } as unknown as NeedsValidationFinding;
    expect(fingerprint(asLead)).toBe(before);
  });

  it("refuses a fingerprint that is present but malformed", () => {
    for (const bad of ["has space", "-leading-dash", "x".repeat(301), "ünï", "a\nb"]) {
      expect(() => fingerprint({ fingerprint: bad })).toThrow(AuditImportError);
    }
    expect(() => fingerprint({ fingerprint: 42 as unknown as string })).toThrow(
      /malformed/,
    );
  });

  describe("when a record has none, it is made from the trace", () => {
    const bare = (): ConfirmedFinding => {
      const f = confirmed() as Partial<ConfirmedFinding>;
      delete f.fingerprint;
      return f as ConfirmedFinding;
    };

    it("is sha256: and 64 hex digits, and a valid fingerprint by the skill's rule", () => {
      const fp = fingerprint(bare());
      expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(fp).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/);
      expect(fingerprint({ ...bare(), fingerprint: "" })).toBe(fp);
      expect(fingerprint({ ...bare(), fingerprint: null })).toBe(fp);
    });

    it("is stable across line moves, rewording, verdict, step order and path spelling", () => {
      const fp = fingerprint(bare());
      const moved = bare();
      moved.trace = [...moved.trace!].reverse().map((t) => ({
        ...t,
        line: t.line + 7,
        file: `./${t.file.replace(/\//g, "//")}`,
        scope: ` ${t.scope} `,
      }));
      moved.title = "Reworded";
      moved.root_cause = "Reworded.";
      expect(fingerprint(moved)).toBe(fp);
      const lead = {
        ...moved,
        verdict: "needs_validation",
      } as unknown as NeedsValidationFinding;
      expect(fingerprint(lead)).toBe(fp);
    });

    it("changes when the file, the function or the kind of step changes", () => {
      const fp = fingerprint(bare());
      const file = bare();
      file.trace![0]!.file = "src/other/place.ts";
      const scope = bare();
      scope.trace![1]!.scope = "another";
      const kind = bare();
      kind.trace![0]!.kind = "propagation";
      const fps = [fingerprint(file), fingerprint(scope), fingerprint(kind)];
      expect(new Set([fp, ...fps]).size).toBe(4);
    });

    it("falls back to the evidence files, then to the title", () => {
      const noTrace = bare() as Partial<ConfirmedFinding>;
      delete noTrace.trace;
      const a = fingerprint(noTrace as ConfirmedFinding);
      const e = noTrace.evidence!.map((x) => ({ ...x, line: x.line + 50 }));
      expect(fingerprint({ ...noTrace, evidence: e } as ConfirmedFinding)).toBe(a);
      expect(
        fingerprint({ ...noTrace, evidence: [{ file: "src/x.ts" }] } as ConfirmedFinding),
      ).not.toBe(a);

      const titleOnly = { title: "  The Same   Title " };
      expect(fingerprint(titleOnly)).toBe(fingerprint({ title: "the same title" }));
      expect(fingerprint(titleOnly)).not.toBe(fingerprint({ title: "another" }));
    });
  });
});

describe("parseFindings", () => {
  it("reads the array, or the text of the file", () => {
    expect(parseFindings(findings())).toHaveLength(7);
    expect(parseFindings(fixture("findings.json"))).toHaveLength(7);
    expect(parseFindings([])).toEqual([]);
  });

  const raises = (value: unknown, message: string | RegExp) => {
    expect(() => parseFindings(value)).toThrow(AuditImportError);
    expect(() => parseFindings(value)).toThrow(message);
  };

  it("refuses what is not findings.json, with a sentence", () => {
    raises("{not json", "findings is not valid JSON.");
    raises({ verdict: "confirmed" }, "findings must be the findings.json array.");
    raises(null, "findings must be the findings.json array.");
    raises([1], "findings[0] is not an object.");
    raises([[]], "findings[0] is not an object.");
    raises(
      Array.from({ length: 1001 }, () => ({})),
      "More than 1000 findings in one import.",
    );
  });

  it("refuses a bad verdict, fingerprint, title or severity and names the finding", () => {
    const ok = (): Record<string, unknown> => ({ ...confirmed() });
    raises(
      [{ ...ok(), verdict: "probable" }],
      "findings[0].verdict must be confirmed, needs_validation or rejected.",
    );
    raises(
      [{ ...ok(), fingerprint: "has space" }],
      "findings[0].fingerprint is missing or malformed.",
    );
    raises(
      [{ ...ok(), fingerprint: undefined }],
      "findings[0].fingerprint is missing or malformed.",
    );
    raises([{ ...ok(), title: "   " }], "findings[0].title is empty.");
    raises(
      [{ ...ok(), severity: { overall_severity: "huge" } }],
      /findings\[0\] \(api-high-missing-ownership-check\) has no valid severity/,
    );
    raises([ok(), ok()], "Duplicate fingerprint api-high-missing-ownership-check.");
  });

  it("does not ask a lead or a rejection for a severity", () => {
    expect(
      parseFindings([
        byFp("web-needs-sample-upload-limit"),
        byFp("web-rejected-sample-xss"),
      ]),
    ).toHaveLength(2);
  });
});

describe("summariseAudit", () => {
  it("summarises the sample run: id, commit, profile, scope, status, coverage and findings", () => {
    expect(
      summariseAudit(fixture("findings.json"), { run: RUN, ledger: LEDGER }),
    ).toEqual({
      runId: "sample-run-2026-11-01",
      commit: "0123456789abcdef0123456789abcdef01234567",
      profile: "standard",
      scope: [],
      status: "complete",
      incompleteReason: "",
      partial: false,
      coverage: {
        blocked: 1,
        candidate: 1,
        covered: 3,
        deferred: 1,
        out_of_scope: 1,
        planned: 1,
      },
      findings: {
        total: 7,
        confirmed: 5,
        needsValidation: 1,
        rejected: 1,
        bySeverity: { critical: 1, high: 1, medium: 1, low: 1, informational: 1 },
      },
    });
  });

  it("lists every severity even with no findings", () => {
    const s = summariseAudit([], { run: RUN });
    expect(s.findings).toEqual({
      total: 0,
      confirmed: 0,
      needsValidation: 0,
      rejected: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, informational: 0 },
    });
  });

  it("counts severities of confirmed findings only", () => {
    const two = [
      confirmed("api-critical-account-takeover"),
      confirmed("api-critical-account-takeover"),
    ].map((f, i) => ({
      ...f,
      fingerprint: `copy-${i}`,
    }));
    const s = summariseAudit([...two, byFp("web-needs-sample-upload-limit")]);
    expect(s.findings.bySeverity.critical).toBe(2);
    expect(s.findings.needsValidation).toBe(1);
  });

  it("is a partial pass for a quick run, a scoped run and an incomplete run", () => {
    expect(summariseAudit([], { run: { ...RUN, profile: "quick" } })).toMatchObject({
      profile: "quick",
      partial: true,
      status: "complete",
    });
    expect(
      summariseAudit([], { run: { ...RUN, scope_paths: ["packages/api", " "] } }),
    ).toMatchObject({ scope: ["packages/api"], partial: true });
    expect(summariseAudit([], { run: { ...RUN, profile: "deep" } })).toMatchObject({
      profile: "deep",
      partial: false,
    });
    expect(
      summariseAudit([], {
        run: {
          ...RUN,
          run_status: "incomplete",
          incomplete_reason: "validation_budget_exhausted",
        },
      }),
    ).toMatchObject({
      status: "incomplete",
      incompleteReason: "validation_budget_exhausted",
      partial: true,
    });
  });

  it("reads a run that is still in progress, or has no metadata, as incomplete", () => {
    expect(
      summariseAudit([], { run: { ...RUN, run_status: "in_progress" } }),
    ).toMatchObject({ status: "incomplete", partial: true });
    expect(summariseAudit([])).toMatchObject({
      runId: "",
      commit: "",
      profile: "standard",
      scope: [],
      status: "incomplete",
      partial: true,
    });
  });

  it("uses the standard profile for a missing or unknown one", () => {
    expect(summariseAudit([], { run: { ...RUN, profile: "exhaustive" } }).profile).toBe(
      "standard",
    );
    expect(summariseAudit([], { run: { ...RUN, profile: undefined } }).profile).toBe(
      "standard",
    );
  });

  it("takes coverage counts already made, keeping only sound numbers", () => {
    const s = summariseAudit([], {
      run: RUN,
      coverage: {
        covered: 40.9,
        candidate: 3,
        blocked: -2,
        "Bad Key": 4,
        deferred: "5",
        nope: Number.NaN,
      },
    });
    expect(s.coverage).toEqual({ covered: 40, candidate: 3, blocked: 0 });
  });

  it("prefers the ledger to counts when both are given", () => {
    expect(
      summariseAudit([], { run: RUN, ledger: LEDGER, coverage: { covered: 99 } }).coverage
        .covered,
    ).toBe(3);
  });

  it("refuses findings the helpers cannot read", () => {
    expect(() => summariseAudit("nope")).toThrow(AuditImportError);
  });
});

describe("coverageCounts", () => {
  it("counts units by status", () => {
    expect(coverageCounts(LEDGER)).toEqual({
      blocked: 1,
      candidate: 1,
      covered: 3,
      deferred: 1,
      out_of_scope: 1,
      planned: 1,
    });
  });

  it("skips what is not a unit with a status, and is empty for what is not a list", () => {
    expect(
      coverageCounts([
        { status: "covered" },
        null,
        5,
        { status: 3 },
        { status: "Bad-Status" },
        {},
      ]),
    ).toEqual({ covered: 1 });
    expect(coverageCounts({ status: "covered" })).toEqual({});
    expect(coverageCounts(undefined)).toEqual({});
  });
});
