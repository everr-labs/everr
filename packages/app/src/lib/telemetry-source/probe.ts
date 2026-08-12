import { LOCAL_SQL_ORIGINS } from "./local";

/**
 * The cheapest query the collector can answer. Probing the SQL route itself
 * (rather than the collector's health port) keeps this on the one endpoint that
 * carries the CORS allowlist, so a reachable probe proves the browser can
 * actually read query results and not merely that a process is listening.
 */
const PROBE_SQL = "SELECT 1";

const PROBE_TIMEOUT_MS = 1500;

async function reaches(origin: string, signal?: AbortSignal): Promise<boolean> {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const combined = signal
    ? AbortSignal.any([signal, timeout])
    : (timeout as AbortSignal);

  try {
    const response = await fetch(`${origin}/sql`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: PROBE_SQL,
      signal: combined,
    });
    return response.ok;
  } catch {
    // Not running, wrong port, or an origin the collector does not allow. All
    // three mean the same thing to the app: local is not available.
    return false;
  }
}

/**
 * Find a reachable collector, or null. Debug and release builds listen on
 * different ports and the app cannot know which one this machine runs, so both
 * are tried and the first to answer wins.
 */
export async function probeLocalCollector(
  signal?: AbortSignal,
): Promise<string | null> {
  for (const origin of LOCAL_SQL_ORIGINS) {
    if (await reaches(origin, signal)) return origin;
  }
  return null;
}
