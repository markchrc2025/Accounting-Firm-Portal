import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGithubSignature } from "../src";

const SECRET = "It's a Secret to Everybody";
const BODY = new TextEncoder().encode("Hello, World!");
// The test vector from GitHub's "Validating webhook deliveries" page.
const GITHUB_VECTOR =
  "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17";

const sign = (body: Uint8Array | string, secret: string) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("verifyGithubSignature: valid", () => {
  it("accepts GitHub's published test vector", () => {
    expect(verifyGithubSignature(BODY, GITHUB_VECTOR, SECRET)).toBe(true);
  });

  it("accepts a signature made over the same bytes, from a Buffer or a Uint8Array", () => {
    const payload = JSON.stringify({
      action: "closed",
      number: 7,
      pull_request: { merged: true },
    });
    const header = sign(payload, "invented-secret");
    expect(verifyGithubSignature(Buffer.from(payload), header, "invented-secret")).toBe(
      true,
    );
    expect(
      verifyGithubSignature(
        new Uint8Array(Buffer.from(payload)),
        header,
        "invented-secret",
      ),
    ).toBe(true);
  });

  it("accepts upper-case hex digits and a secret given as bytes", () => {
    const header = `sha256=${GITHUB_VECTOR.slice("sha256=".length).toUpperCase()}`;
    expect(verifyGithubSignature(BODY, header, SECRET)).toBe(true);
    expect(
      verifyGithubSignature(BODY, GITHUB_VECTOR, new TextEncoder().encode(SECRET)),
    ).toBe(true);
  });

  it("checks the bytes, including non-text ones and an empty body", () => {
    const bytes = new Uint8Array([0, 255, 128, 10, 13]);
    expect(verifyGithubSignature(bytes, sign(bytes, "k"), "k")).toBe(true);
    const empty = new Uint8Array(0);
    expect(verifyGithubSignature(empty, sign(empty, "k"), "k")).toBe(true);
  });
});

describe("verifyGithubSignature: refused", () => {
  it("refuses the wrong secret", () => {
    expect(verifyGithubSignature(BODY, GITHUB_VECTOR, "another secret")).toBe(false);
    expect(verifyGithubSignature(BODY, GITHUB_VECTOR, `${SECRET} `)).toBe(false);
  });

  it("refuses a body that changed by one byte, or a different encoding of the same text", () => {
    expect(
      verifyGithubSignature(
        new TextEncoder().encode("Hello, World?"),
        GITHUB_VECTOR,
        SECRET,
      ),
    ).toBe(false);
    expect(
      verifyGithubSignature(
        new TextEncoder().encode("Hello, World! "),
        GITHUB_VECTOR,
        SECRET,
      ),
    ).toBe(false);
    const pretty = JSON.stringify({ a: 1 }, null, 2);
    expect(
      verifyGithubSignature(
        Buffer.from(JSON.stringify({ a: 1 })),
        sign(pretty, "k"),
        "k",
      ),
    ).toBe(false);
  });

  it("refuses a signature of the wrong length", () => {
    expect(verifyGithubSignature(BODY, GITHUB_VECTOR.slice(0, -2), SECRET)).toBe(false);
    expect(verifyGithubSignature(BODY, `${GITHUB_VECTOR}00`, SECRET)).toBe(false);
    expect(verifyGithubSignature(BODY, "sha256=", SECRET)).toBe(false);
    expect(verifyGithubSignature(BODY, "sha256=abcd", SECRET)).toBe(false);
  });

  it("refuses a header with no sha256= prefix, another prefix or the old sha1 header", () => {
    expect(
      verifyGithubSignature(BODY, GITHUB_VECTOR.slice("sha256=".length), SECRET),
    ).toBe(false);
    expect(
      verifyGithubSignature(BODY, GITHUB_VECTOR.replace("sha256=", "SHA256="), SECRET),
    ).toBe(false);
    expect(
      verifyGithubSignature(BODY, GITHUB_VECTOR.replace("sha256=", "sha512="), SECRET),
    ).toBe(false);
    const sha1 = `sha1=${createHmac("sha1", SECRET).update(BODY).digest("hex")}`;
    expect(verifyGithubSignature(BODY, sha1, SECRET)).toBe(false);
  });

  it("refuses non-hex characters, and spaces around the value", () => {
    expect(verifyGithubSignature(BODY, `sha256=${"z".repeat(64)}`, SECRET)).toBe(false);
    expect(verifyGithubSignature(BODY, ` ${GITHUB_VECTOR}`, SECRET)).toBe(false);
    expect(verifyGithubSignature(BODY, `${GITHUB_VECTOR}\n`, SECRET)).toBe(false);
  });

  it("refuses a missing, empty or repeated header without throwing", () => {
    expect(verifyGithubSignature(BODY, undefined, SECRET)).toBe(false);
    expect(verifyGithubSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyGithubSignature(BODY, "", SECRET)).toBe(false);
    expect(verifyGithubSignature(BODY, [GITHUB_VECTOR], SECRET)).toBe(false);
    expect(verifyGithubSignature(BODY, [GITHUB_VECTOR, GITHUB_VECTOR], SECRET)).toBe(
      false,
    );
  });

  it("refuses an empty secret, even for a signature made with an empty secret", () => {
    expect(verifyGithubSignature(BODY, sign(BODY, ""), "")).toBe(false);
    expect(verifyGithubSignature(BODY, sign(BODY, ""), new Uint8Array(0))).toBe(false);
  });

  it("refuses a body that is not bytes, without throwing", () => {
    const text = "Hello, World!" as unknown as Uint8Array;
    expect(verifyGithubSignature(text, GITHUB_VECTOR, SECRET)).toBe(false);
    expect(
      verifyGithubSignature(null as unknown as Uint8Array, GITHUB_VECTOR, SECRET),
    ).toBe(false);
    expect(
      verifyGithubSignature({} as unknown as Uint8Array, GITHUB_VECTOR, SECRET),
    ).toBe(false);
  });
});
