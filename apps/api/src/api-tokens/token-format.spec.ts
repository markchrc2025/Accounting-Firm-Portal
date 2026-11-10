// token-format.spec.ts — PA3 (D67): the shape of a personal API token, how it is hashed, how a
// bearer header is read. The plain token exists only in the response that makes it.
import { createHash } from "node:crypto";
import {
  generateToken,
  hashToken,
  looksLikeToken,
  parseBearer,
  TOKEN_PREFIX,
} from "./token-format";

describe("PA3 · personal token format", () => {
  it("a token is ppt_ and 43 URL-safe characters, and every one is different", () => {
    const seen = new Set<string>();
    for (let n = 0; n < 200; n++) {
      const { token } = generateToken();
      expect(token).toMatch(/^ppt_[A-Za-z0-9_-]{43}$/);
      expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
      seen.add(token);
    }
    expect(seen.size).toBe(200);
  });

  it("the stored hash is the SHA-256 of the token in hex, never the token; the prefix is its first 10 characters", () => {
    const { token, hash, prefix } = generateToken();
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashToken(token)).toBe(hash);
    expect(hashToken(`${token} `)).not.toBe(hash);
    expect(prefix).toBe(token.slice(0, 10));
    expect(prefix).toHaveLength(10);
  });

  it("looksLikeToken only accepts the exact shape (a JWT or a stray string is never looked up)", () => {
    const { token } = generateToken();
    expect(looksLikeToken(token)).toBe(true);
    for (const bad of [
      "",
      "ppt_",
      token.slice(0, -1),
      `${token}x`,
      token.replace("ppt_", "spk_"),
      `${token}\n`,
      " " + token,
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
      "ppt_" + "!".repeat(43),
    ]) {
      expect(looksLikeToken(bad)).toBe(false);
    }
  });

  it("parseBearer reads Authorization: Bearer <value> in any letter case and nothing else", () => {
    expect(parseBearer("Bearer abc")).toBe("abc");
    expect(parseBearer("bearer abc")).toBe("abc");
    expect(parseBearer("BEARER abc")).toBe("abc");
    expect(parseBearer(undefined)).toBeUndefined();
    expect(parseBearer("")).toBeUndefined();
    expect(parseBearer("Basic abc")).toBeUndefined();
    expect(parseBearer("Bearer")).toBeUndefined();
    expect(parseBearer("Bearer a b")).toBeUndefined();
  });
});
