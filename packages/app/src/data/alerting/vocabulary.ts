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
  "delivery",
  "rule_health",
  "silenced",
  "hold_changed",
  "evaluation_failed",
] as const;
