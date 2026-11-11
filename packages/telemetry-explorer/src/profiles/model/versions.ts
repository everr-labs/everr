import { resolveTimeRange, type TimeRange } from "@everr/ui/lib/time-range";

/** A `service.version` and when its samples were seen. */
export type ProfileVersion = {
  version: string;
  /** ISO timestamps. */
  firstSeen: string;
  lastSeen: string;
};

// How far back to look for the version before the current one; a release
// cadence slower than this has no baseline.
export const VERSION_LOOKBACK_DAYS = 14;
const VERSION_LOOKBACK_MS = VERSION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

/** The window to list versions in: the current range plus the lookback before it. */
export function versionLookupRange(range: TimeRange, now = new Date()): TimeRange {
  const { fromDate, toDate } = resolveTimeRange(range, now);
  return {
    from: new Date(fromDate.getTime() - VERSION_LOOKBACK_MS).toISOString(),
    to: toDate.toISOString(),
  };
}

/**
 * The two versions to compare: the requested ones, else the most recently
 * seen version and the one seen before it. `versions` is ordered by last seen,
 * latest first.
 */
export function pickVersions(
  versions: readonly ProfileVersion[],
  requested: { version?: string; baseVersion?: string },
): { comparison: ProfileVersion | undefined; baseline: ProfileVersion | undefined } {
  const comparison =
    versions.find((v) => v.version === requested.version) ?? versions[0] ?? undefined;
  const requestedBaseline = versions.find(
    (v) => v.version === requested.baseVersion && v.version !== comparison?.version,
  );
  if (requestedBaseline) return { comparison, baseline: requestedBaseline };
  const comparisonIndex = comparison ? versions.indexOf(comparison) : -1;
  const baseline =
    versions.slice(comparisonIndex + 1).find((v) => v.version !== comparison?.version) ??
    versions.find((v) => v.version !== comparison?.version);
  return { comparison, baseline };
}

/**
 * The baseline window for a version: as long as the current range, ending when
 * the version was last seen, and never before it was first seen.
 */
export function versionWindow(version: ProfileVersion, lengthMs: number): TimeRange {
  const lastSeen = new Date(version.lastSeen).getTime();
  const firstSeen = new Date(version.firstSeen).getTime();
  return {
    from: new Date(Math.max(firstSeen, lastSeen - lengthMs)).toISOString(),
    // ClickHouse keeps nanoseconds that the ISO string drops; the extra
    // millisecond keeps the last sample inside the window.
    to: new Date(lastSeen + 1).toISOString(),
  };
}
