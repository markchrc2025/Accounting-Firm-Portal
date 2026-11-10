// track-b-pb5-logic.test.ts - PB5: the small helpers for sessions, the sentences of a refusal, and
// the exact call of the sessions route.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import {
  errorLines,
  fetchSessions,
  sessionPath,
  sessionTitle,
  sessionWho,
} from "./projects";

describe("PB5 sessions: who, what, where", () => {
  it("the person who ran it, or Claude when no person is known", () => {
    expect(sessionWho({ user: { id: "u1", fullName: "Ana Reyes" } })).toBe("Ana Reyes");
    expect(sessionWho({ user: null })).toBe("Claude");
  });
  it("its title, or the word Session", () => {
    expect(sessionTitle({ title: "Fix the form" })).toBe("Fix the form");
    expect(sessionTitle({ title: "" })).toBe("Session");
    expect(sessionTitle({ title: "   " })).toBe("Session");
  });
  it("the Sessions tab, optionally at one session (the id is escaped)", () => {
    expect(sessionPath("PAY")).toBe("/projects/PAY/sessions");
    expect(sessionPath("PAY", "abc-123")).toBe("/projects/PAY/sessions?session=abc-123");
    expect(sessionPath("PAY", "a b&c")).toBe("/projects/PAY/sessions?session=a%20b%26c");
  });
});

describe("PB5 the sentences of a refusal", () => {
  it("an ordinary refusal is still one sentence", () => {
    expect(
      errorLines(new ApiError(409, "That key already exists in the firm.", {})),
    ).toEqual(["That key already exists in the firm."]);
  });
  it("the validation form is unchanged", () => {
    expect(
      errorLines(
        new ApiError(400, "Validation failed", {
          errors: [{ message: "One." }, { message: "Two." }],
        }),
      ),
    ).toEqual(["One.", "Two."]);
  });
});

describe("PB5 the sessions call", () => {
  let calls: Array<{ url: string; init: RequestInit }> = [];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const last = () => {
    const c = calls.at(-1)!;
    const u = new URL(c.url);
    return {
      path: u.pathname.replace(/^.*\/api\/v1/, ""),
      q: u.searchParams,
      init: c.init,
      body: c.init.body ? JSON.parse(c.init.body as string) : undefined,
    };
  };

  it("sessions are asked for a page at a time", async () => {
    await fetchSessions("PAY", { page: 2, pageSize: 25 });
    expect(last().path).toBe("/projects/PAY/sessions");
    expect(Object.fromEntries(last().q)).toEqual({ page: "2", pageSize: "25" });
  });
});
