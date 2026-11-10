// preview-limit.spec.ts — U23: 40 previews a minute per user, in a sliding window.
import { PREVIEWS_PER_MINUTE, PreviewLimiter, TOO_MANY_PREVIEWS } from "./preview-limit";

describe("U23 · the preview limit", () => {
  it("the numbers and the sentence the owner gave", () => {
    expect(PREVIEWS_PER_MINUTE).toBe(40);
    expect(TOO_MANY_PREVIEWS).toBe("Too many previews; wait a moment.");
  });

  it("forty are taken inside a minute; the forty-first is not, and is not counted", () => {
    const l = new PreviewLimiter();
    for (let i = 0; i < 40; i++) expect(l.take("u", 1_000 + i)).toBe(true);
    expect(l.take("u", 1_100)).toBe(false);
    expect(l.take("u", 1_200)).toBe(false);
    // exactly a minute after the first, one place opens, not two
    expect(l.take("u", 61_000)).toBe(true);
    expect(l.take("u", 61_000)).toBe(false);
    // and a minute after the last, all are free again
    expect(l.take("u", 61_039)).toBe(true);
  });

  it("each user has his own count, and reset forgets them", () => {
    const l = new PreviewLimiter(2, 60_000);
    expect([l.take("a", 0), l.take("a", 1), l.take("a", 2)]).toEqual([true, true, false]);
    expect(l.take("b", 3)).toBe(true);
    l.reset();
    expect(l.take("a", 4)).toBe(true);
  });
});
