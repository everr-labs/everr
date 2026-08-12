import type { TelemetrySourceKind } from "./types";

export const TELEMETRY_SOURCE_STORAGE_KEY = "everr.telemetry-source";

/**
 * Cloud is the default, so a fresh browser and a colleague's machine behave the
 * way the app has always behaved. Follows the sidebar's persistence pattern:
 * localStorage, read once before paint, every access best-effort because a
 * blocked storage partition must not break the page.
 */
export function readStoredSource(): TelemetrySourceKind | null {
  try {
    const stored = window.localStorage.getItem(TELEMETRY_SOURCE_STORAGE_KEY);
    if (stored === "cloud" || stored === "local") return stored;
  } catch {
    // Private mode or a blocked storage partition: fall back to the default.
  }
  return null;
}

export function writeStoredSource(kind: TelemetrySourceKind) {
  try {
    window.localStorage.setItem(TELEMETRY_SOURCE_STORAGE_KEY, kind);
  } catch {
    // Persistence is best effort.
  }
}
