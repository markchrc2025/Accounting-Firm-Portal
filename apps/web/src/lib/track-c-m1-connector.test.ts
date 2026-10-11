// M1 R3 — the Claude Connector card's sentences (lib/mcpConnector.ts).
import { describe, expect, it } from "vitest";
import { ROTATE_AS_ADVICE, actingLines, type McpConnectorStatus } from "./mcpConnector";

const SENTENCE =
  "More than one active Super Admin. Issue the connector key from the Portal's MCP " +
  "Connector page as the Super Admin Claude should act as.";
const A = { name: "Invented Admin A", email: "a@example.test" };
const on = (extra: Partial<McpConnectorStatus>): McpConnectorStatus => ({
  enabled: true,
  source: "portal",
  secret: "not-a-real-secret-0123456789-0123456789",
  ...extra,
});

describe("M1 · the connector card's sentences", () => {
  it("issued and acting: one line, the date on Manila's calendar", () => {
    expect(
      actingLines(on({ issuedBy: A, issuedAt: "2026-10-10T17:30:00.000Z", actingAs: A })),
    ).toEqual({
      summary:
        "Issued by Invented Admin A on Oct 11, 2026. Claude acts as Invented Admin A.",
      problem: null,
      advice: null,
    });
  });

  it("the environment link with a single Super Admin: no issuer, Claude acts as them", () => {
    expect(
      actingLines(on({ source: "environment", issuedBy: null, actingAs: A })),
    ).toEqual({
      summary: "Claude acts as Invented Admin A.",
      problem: null,
      advice: null,
    });
  });

  it("no one acting: the refusal sentence and the advice to rotate", () => {
    expect(
      actingLines(
        on({
          source: "environment",
          issuedBy: null,
          actingAs: null,
          actingProblem: SENTENCE,
        }),
      ),
    ).toEqual({ summary: null, problem: SENTENCE, advice: ROTATE_AS_ADVICE });
    expect(ROTATE_AS_ADVICE).toBe(
      "Rotate the link while signed in as the Super Admin Claude should act as.",
    );
  });

  it("the connector off, or not loaded: nothing", () => {
    const none = { summary: null, problem: null, advice: null };
    expect(actingLines(undefined)).toEqual(none);
    expect(actingLines({ enabled: false, source: null, secret: null })).toEqual(none);
  });
});
