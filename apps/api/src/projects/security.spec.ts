// security.spec.ts — PA4 (D68): which issues are open security findings, how severe, and what that
// means for a project: clear, open findings, or blocked (a milestone cannot close).
import {
  blockingKeys,
  classifySecurityIssue,
  gateMessage,
  securitySummary,
  type OpenSecurityIssue,
} from "./security";

const issue = (
  key: string,
  labels: string[],
  extra: Partial<OpenSecurityIssue> = {},
): OpenSecurityIssue | null => {
  const c = classifySecurityIssue(labels);
  return c
    ? {
        key,
        number: Number(key.split("-")[1]),
        title: `T ${key}`,
        fingerprint: null,
        ...c,
        ...extra,
      }
    : null;
};
const open = (...xs: (OpenSecurityIssue | null)[]) =>
  xs.filter((x): x is OpenSecurityIssue => !!x);

describe("PA4 · security issues", () => {
  it("an issue is a security issue only with the label security; its severity is its sev- label", () => {
    expect(classifySecurityIssue(["bug", "sev-high"])).toBeNull();
    expect(classifySecurityIssue([])).toBeNull();
    expect(classifySecurityIssue(["security"])).toEqual({
      severity: null,
      needsValidation: false,
    });
    expect(classifySecurityIssue(["security", "sev-critical"])).toEqual({
      severity: "critical",
      needsValidation: false,
    });
    expect(classifySecurityIssue(["Security", "SEV-LOW"])).toEqual({
      severity: "low",
      needsValidation: false,
    });
    expect(classifySecurityIssue(["security", "needs-validation"])).toEqual({
      severity: null,
      needsValidation: true,
    });
    // two severities by hand: the worse one counts
    expect(classifySecurityIssue(["security", "sev-low", "sev-high"])?.severity).toBe(
      "high",
    );
    // a label that only looks like one is not one
    expect(classifySecurityIssue(["security", "sev-urgent"])?.severity).toBeNull();
  });

  it("critical and high block; medium, low, informational, needs-validation and unrated do not", () => {
    const blocked = open(
      issue("PAY-9", ["security", "sev-high"]),
      issue("PAY-3", ["security", "sev-critical"]),
    );
    expect(blockingKeys(blocked)).toEqual(["PAY-3", "PAY-9"]); // by issue number
    const quiet = open(
      issue("PAY-1", ["security", "sev-medium"]),
      issue("PAY-2", ["security", "sev-low"]),
      issue("PAY-4", ["security", "sev-informational"]),
      issue("PAY-5", ["security", "needs-validation"]),
      issue("PAY-6", ["security"]),
    );
    expect(blockingKeys(quiet)).toEqual([]);
  });

  it("the summary: state, counts by severity, leads, unrated, and who blocks", () => {
    expect(securitySummary([])).toEqual({
      state: "clear",
      blockedBy: [],
      counts: {
        open: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        informational: 0,
        needsValidation: 0,
        unrated: 0,
      },
    });
    const some = securitySummary(
      open(
        issue("PAY-1", ["security", "sev-medium"]),
        issue("PAY-5", ["security", "needs-validation"]),
        issue("PAY-6", ["security"]),
      ),
    );
    expect(some.state).toBe("open");
    expect(some.counts).toEqual({
      open: 3,
      critical: 0,
      high: 0,
      medium: 1,
      low: 0,
      informational: 0,
      needsValidation: 1,
      unrated: 1,
    });
    const blocked = securitySummary(
      open(
        issue("PAY-3", ["security", "sev-critical"]),
        issue("PAY-9", ["security", "sev-high"]),
        issue("PAY-6", ["security"]),
      ),
    );
    expect(blocked.state).toBe("blocked");
    expect(blocked.blockedBy).toEqual(["PAY-3", "PAY-9"]);
    expect(blocked.counts).toMatchObject({ open: 3, critical: 1, high: 1, unrated: 1 });
  });

  it("the gate's sentence names the keys", () => {
    expect(gateMessage(["PAY-3", "PAY-9"])).toBe(
      "This milestone cannot be closed while security issues are open: PAY-3, PAY-9.",
    );
    expect(gateMessage(["PAY-3"])).toBe(
      "This milestone cannot be closed while security issues are open: PAY-3.",
    );
  });
});
