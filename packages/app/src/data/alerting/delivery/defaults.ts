// Grouping is fixed, not per-destination config: every notification batches
// by rule and severity with one wait and one pacing interval.
export const ALERTING_DEFAULT_GROUP_BY = ["rule", "severity"] as const;
export const ALERTING_DEFAULT_GROUP_WAIT_SECS = 10;
export const ALERTING_DEFAULT_GROUP_INTERVAL_SECS = 300;

export const ALERTING_DEFAULT_TIERS = [
  "all",
  "critical",
  "warning",
  "info",
] as const;

/** A default-destination tier: "all" is the unsplit mode. */
export type AlertingDefaultTier = (typeof ALERTING_DEFAULT_TIERS)[number];
