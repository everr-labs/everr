import type { ALERTING_EVENT_TYPES } from "../vocabulary";

export type AlertEventType = (typeof ALERTING_EVENT_TYPES)[number];

export function alertingEventStatus(
  eventType: string,
): "firing" | "resolved" | null {
  return eventType === "instance_fired"
    ? "firing"
    : eventType === "instance_resolved"
      ? "resolved"
      : null;
}
