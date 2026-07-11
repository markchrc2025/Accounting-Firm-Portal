// Philippine locations lookup for the client address form: every city /
// municipality with its province, region, and a representative ZIP code.
//
// Source: the `philippines` package (complete PSGC hierarchy — 1,634
// municipalities, 82 provinces, 17 regions) joined to `zipcodes-ph` for postal
// codes by exact normalised name match (~88% of municipalities resolve a ZIP;
// the rest — small municipalities absent from the ZIP source — leave ZIP blank
// for manual entry rather than guess a wrong code). The joined dataset lives in
// `src/data/ph-locations.json` and is lazy-loaded so it stays out of the main
// bundle.

export interface PhLocation {
  city: string;
  province: string;
  region: string;
  regionCode: string;
  /** Representative ZIP, or "" when the source had none for this municipality. */
  zip: string;
}

let cache: PhLocation[] | null = null;
let inflight: Promise<PhLocation[]> | null = null;

/** Lazy-load the dataset once (dynamic import → its own chunk), then cache it. */
export async function loadPhLocations(): Promise<PhLocation[]> {
  if (cache) return cache;
  if (!inflight) {
    inflight = import("../data/ph-locations.json").then((m) => {
      cache = m.default as PhLocation[];
      return cache;
    });
  }
  return inflight;
}

/** Accent-insensitive, punctuation-insensitive key for matching city names. */
function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Rank matches for a typed query: name-prefix hits first, then substring hits,
 * each alphabetically. Returns at most `limit` rows. Empty query → no rows.
 */
export function searchLocations(all: PhLocation[], q: string, limit = 12): PhLocation[] {
  const nq = norm(q);
  if (!nq) return [];
  const prefix: PhLocation[] = [];
  const contains: PhLocation[] = [];
  for (const r of all) {
    const nc = norm(r.city);
    if (nc.startsWith(nq)) prefix.push(r);
    else if (nc.includes(nq)) contains.push(r);
  }
  const byCity = (a: PhLocation, b: PhLocation) => a.city.localeCompare(b.city);
  return [...prefix.sort(byCity), ...contains.sort(byCity)].slice(0, limit);
}
