import countries from "world-countries";

/**
 * ISO-3166 alpha-2 and alpha-3 codes (upper-cased) → the numeric id used by the
 * `world-atlas` TopoJSON (feature.id, e.g. "840"). Built once from
 * `world-countries`, which carries cca2/cca3/ccn3 for every country.
 */
const byCode = new Map<string, string>();
for (const c of countries as Array<{
  cca2: string;
  cca3: string;
  ccn3: string;
}>) {
  if (!c.ccn3) continue;
  byCode.set(c.cca2.toUpperCase(), c.ccn3);
  byCode.set(c.cca3.toUpperCase(), c.ccn3);
}

/** Resolve an ISO alpha-2/alpha-3 region code to its numeric TopoJSON id. */
export function regionToNumericId(code: string): string | undefined {
  return byCode.get(code.trim().toUpperCase());
}
