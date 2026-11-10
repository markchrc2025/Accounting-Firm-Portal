// W23: how the live Preview pane reads the API's answers and remembers its choice.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import {
  problemOf,
  readPaneShown,
  refusalLines,
  validationLines,
  writePaneShown,
} from "./livePreview";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("W23 reading the API's answers", () => {
  it("a 409 is its refusals; with none listed, its message", () => {
    expect(refusalLines(new ApiError(409, "A", { refusals: ["A", "B"] }))).toEqual([
      "A",
      "B",
    ]);
    expect(
      refusalLines(new ApiError(409, "Only this.", { message: "Only this." })),
    ).toEqual(["Only this."]);
    expect(refusalLines(new ApiError(409, "Only this.", { refusals: [] }))).toEqual([
      "Only this.",
    ]);
  });

  it("a 400 is the messages of its errors; without them, its own sentence", () => {
    expect(
      validationLines(
        new ApiError(400, "Validation failed", {
          errors: [
            { path: "a", message: "M1" },
            { path: "b", message: "M2" },
          ],
        }),
      ),
    ).toEqual(["M1", "M2"]);
    expect(validationLines(new ApiError(400, "INVENTED _source sentence.", {}))).toEqual([
      "INVENTED _source sentence.",
    ]);
  });

  it("each status reads as its kind; anything else is a failure to load", () => {
    expect(problemOf(new ApiError(409, "x", { refusals: ["x"] })).kind).toBe("refused");
    expect(problemOf(new ApiError(400, "x", {})).kind).toBe("invalid");
    expect(problemOf(new ApiError(429, "Too many previews; wait a moment.", {}))).toEqual(
      {
        kind: "wait",
        line: "Too many previews; wait a moment.",
      },
    );
    expect(problemOf(new ApiError(403, "Forbidden.", {}))).toEqual({
      kind: "refused",
      lines: ["Forbidden."],
    });
    expect(problemOf(new ApiError(404, "Form not found.", {}))).toEqual({
      kind: "refused",
      lines: ["Form not found."],
    });
    expect(problemOf(new ApiError(500, "boom", {})).kind).toBe("failed");
    expect(problemOf(new TypeError("Failed to fetch")).kind).toBe("failed");
  });
});

describe("W23 the choice to show or hide", () => {
  it("is shown unless the user hid it, and is kept per user", () => {
    expect(readPaneShown("u1")).toBe(true);
    writePaneShown("u1", false);
    expect(readPaneShown("u1")).toBe(false);
    expect(readPaneShown("u2")).toBe(true);
    writePaneShown("u1", true);
    expect(readPaneShown("u1")).toBe(true);
  });

  it("works without storage: shown, and writing does not throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readPaneShown("u1")).toBe(true);
    expect(() => writePaneShown("u1", false)).not.toThrow();
  });
});
