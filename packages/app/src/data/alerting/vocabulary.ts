export const ALERTING_SEVERITIES = ["info", "warning", "critical"] as const;

export const ALERTING_INSTANCE_STATUSES = [
  "inactive",
  "pending",
  "firing",
] as const;

export const ALERTING_HEALTH_STATUSES = ["healthy", "degraded"] as const;

// `instance_closed` is the terminal that ends an instance without notifying
// anybody (pending cleared, rule paused, rule deleted, preview deleted).
// `instance_resolved` stays the notifying resolve, so closing must never
// borrow its name or its display status.
export const ALERTING_EVENT_TYPES = [
  "instance_pending",
  "instance_fired",
  "instance_resolved",
  "instance_closed",
  "evaluation_failed",
] as const;

// The closed vocabulary of reasons a terminal row can carry. History rows are
// append-only, so a typo here would be an unlabelled reason forever; every
// writer must pick from this list, not from a bare string.
export const ALERTING_LIFECYCLE_REASONS = [
  "condition_cleared",
  "pending_cleared",
  "labels_changed",
  "rule_paused",
  "rule_deleted",
  "preview_deleted",
  // A firing event reached delivery processing after its instance had
  // already stopped firing (a worker outage and recovery, most often): the
  // notification is withheld, not dropped silently.
  "no_longer_firing",
  // A group flushed a notification-worthy set to a receiver or rule with no
  // channels attached: nothing was sent, but the chain still needs an
  // outcome.
  "no_channels",
] as const;

export type AlertingLifecycleReason =
  (typeof ALERTING_LIFECYCLE_REASONS)[number];

export function isAlertingLifecycleReason(
  value: string,
): value is AlertingLifecycleReason {
  return (ALERTING_LIFECYCLE_REASONS as readonly string[]).includes(value);
}
