import { mcpEnabled, mcpKeyMatches, MCP_SECRET_MIN_LENGTH } from "./mcp-secret";

const STRONG = "a".repeat(MCP_SECRET_MIN_LENGTH);

describe("mcp-secret — capability-URL gate", () => {
  it("is disabled when the env secret is unset", () => {
    expect(mcpEnabled(undefined)).toBe(false);
    expect(mcpKeyMatches(STRONG, undefined)).toBe(false);
  });

  it("is disabled when the env secret is too short to be safe", () => {
    const weak = "short-secret";
    expect(mcpEnabled(weak)).toBe(false);
    // Even a correct-but-weak key must not open the endpoint.
    expect(mcpKeyMatches(weak, weak)).toBe(false);
  });

  it("accepts exactly the configured key", () => {
    expect(mcpKeyMatches(STRONG, STRONG)).toBe(true);
  });

  it("rejects a wrong key of any length", () => {
    expect(mcpKeyMatches("b".repeat(MCP_SECRET_MIN_LENGTH), STRONG)).toBe(false);
    expect(mcpKeyMatches(`${STRONG}x`, STRONG)).toBe(false);
    expect(mcpKeyMatches(STRONG.slice(0, -1), STRONG)).toBe(false);
  });

  it("rejects an empty provided key", () => {
    expect(mcpKeyMatches("", STRONG)).toBe(false);
  });
});
