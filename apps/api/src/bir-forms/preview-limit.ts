// preview-limit.ts — U23 (D64): the live Preview is asked for while the user types, so it
// is limited per user: 40 a minute, counted in a sliding window held in this process.
// (One API process: a second one would count on its own.)
export const PREVIEWS_PER_MINUTE = 40;
export const TOO_MANY_PREVIEWS = "Too many previews; wait a moment.";

export class PreviewLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max = PREVIEWS_PER_MINUTE,
    private readonly windowMs = 60_000,
  ) {}

  /** Count one preview for this user; false when the limit is reached (nothing is counted then). */
  take(userId: string, now = Date.now()): boolean {
    const recent = (this.hits.get(userId) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(userId, recent);
    // keep the map small: forget users who have been quiet for a window
    if (this.hits.size > 1000) {
      for (const [k, v] of this.hits) {
        if (v.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
      }
    }
    return true;
  }

  reset(): void {
    this.hits.clear();
  }
}

export const previewLimiter = new PreviewLimiter();
