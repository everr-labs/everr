// Shared CC alert history event types.
export const ALERT_EVENT_TYPES = [
  "instance_fired",
  "instance_resolved",
  "delivery",
  "rule_health",
  "silenced",
] as const;

export type AlertEventType = (typeof ALERT_EVENT_TYPES)[number];

/**
 * The instance-state transition an event type represents, or null when the
 * event is not a transition (delivery, silence, and evaluation events).
 *
 * Lives here rather than in the feed component so a caller that only needs to
 * classify an event type does not pull a whole rendering module — and its
 * server-side query chain — along with it.
 */
export function ccEventStatus(eventType: string): "firing" | "resolved" | null {
  return eventType === "instance_fired"
    ? "firing"
    : eventType === "instance_resolved"
      ? "resolved"
      : null;
}
