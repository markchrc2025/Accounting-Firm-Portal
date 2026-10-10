// track-b-w9.test.ts — the sign-in page's words for a refused provider sign-in
// (W9 R1).

import { describe, expect, it } from "vitest";
import { ssoErrorMessage } from "./ssoErrors";

const MS =
  "This Microsoft account's email is not verified. Sign in with your email and password, or with Google.";
const GOOGLE =
  "This Google account's email is not verified. Sign in with your email and password, or with Microsoft.";

describe("ssoErrorMessage — an unverified provider email (R1)", () => {
  it("names Microsoft when U9 sends no provider, or provider=microsoft", () => {
    expect(ssoErrorMessage("email-unverified")).toBe(MS);
    expect(ssoErrorMessage("email-unverified", null)).toBe(MS);
    expect(ssoErrorMessage("email-unverified", "microsoft")).toBe(MS);
  });
  it("names Google for provider=google", () => {
    expect(ssoErrorMessage("email-unverified", "google")).toBe(GOOGLE);
  });
});

describe("ssoErrorMessage — every other code keeps today's text", () => {
  it("a known code keeps its own words, whatever the provider", () => {
    expect(ssoErrorMessage("cancelled", "google")).toBe(
      "Sign-in was cancelled at the provider.",
    );
  });
  it("an unknown code reads the generic failure", () => {
    expect(ssoErrorMessage("zz-not-a-code")).toBe(
      "SSO sign-in failed — please try again.",
    );
  });
  it("a provider config code is appended, as before", () => {
    expect(ssoErrorMessage("provider", "microsoft", "AADSTS00000")).toMatch(
      / \(provider code: AADSTS00000\)$/,
    );
  });
});
