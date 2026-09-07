// Grouping is fixed, not per-destination config: every notification batches
// by rule and severity with one wait and one pacing interval.
export const ALERTING_DEFAULT_GROUP_BY = ["rule", "severity"] as const;
export const ALERTING_DEFAULT_GROUP_WAIT_SECS = 10;
export const ALERTING_DEFAULT_GROUP_INTERVAL_SECS = 300;

/** The severity tiers, worst first: the order every list prints them in. */
export const ALERTING_SEVERITY_TIERS = ["critical", "warning", "info"] as const;

/** Every tier the default destination can hold, "all" first. */
export const ALERTING_DEFAULT_TIERS = [
  "all",
  ...ALERTING_SEVERITY_TIERS,
] as const;

/** A default-destination tier: "all" is the unsplit mode. */
export type AlertingDefaultTier = (typeof ALERTING_DEFAULT_TIERS)[number];

/**
 * The default-destination tier that carries an alert of this severity, out
 * of the tiers on offer, or `null` when none does. The one rule every
 * delivery decision reads: "all" carries everything while it exists, else
 * the alert's own severity tier, else nothing. The worker dispatches by it,
 * the triage board says "no channel for this rule" by it, and the
 * Notifications page lays undelivered counts on a tier by it.
 */
export function defaultTierFor(
  tiers: Iterable<AlertingDefaultTier>,
  severity: AlertingDefaultTier,
): AlertingDefaultTier | null {
  const offered = tiers instanceof Set ? tiers : new Set(tiers);
  if (offered.has("all")) return "all";
  return offered.has(severity) ? severity : null;
}
