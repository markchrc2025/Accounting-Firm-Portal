// birPreview.ts — C3 (D52): the "Preview PDF" button's helpers.

/** JSON with every object's keys in sorted order, so equal data compares equal. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * True when the editor holds changes the server does not have yet: its period or
 * its data differ from the saved form. Then "Preview PDF" saves first, exactly as
 * "Save changes" does, so the preview prints what the editor shows.
 */
export function hasUnsavedChanges(
  saved: { period: string; data: Record<string, unknown> } | undefined,
  period: string,
  data: Record<string, unknown>,
): boolean {
  if (!saved) return false;
  return saved.period !== period || stable(saved.data) !== stable(data);
}
