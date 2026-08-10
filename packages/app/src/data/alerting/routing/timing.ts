import {
  ALERTING_DEFAULT_GROUP_INTERVAL_SECS,
  ALERTING_DEFAULT_GROUP_WAIT_SECS,
} from "./defaults";

export type AlertingRouteTiming = {
  groupBy: string[] | null;
  groupWaitSecs: number | null;
  groupIntervalSecs: number | null;
  repeatIntervalSecs: number | null;
};

function alertingGroupingSummary(groupBy: string[] | null) {
  if (groupBy === null) return "group automatically";
  if (groupBy.length === 0) return "one group";
  return `group by ${groupBy.join(", ")}`;
}

/**
 * Timing parts for one route. `overrides` contains explicit values;
 * `effective` fills unset slots with defaults.
 */
export function alertingRouteTimingSummary(
  timing: AlertingRouteTiming,
  mode: "overrides" | "effective",
): string[] {
  if (mode === "overrides") {
    const parts: string[] = [];
    if (timing.groupBy !== null)
      parts.push(alertingGroupingSummary(timing.groupBy));
    if (timing.groupWaitSecs != null)
      parts.push(`wait ${timing.groupWaitSecs}s`);
    if (timing.groupIntervalSecs != null)
      parts.push(`interval ${timing.groupIntervalSecs}s`);
    if (timing.repeatIntervalSecs != null)
      parts.push(`repeat ${timing.repeatIntervalSecs}s`);
    return parts;
  }
  return [
    `wait ${timing.groupWaitSecs ?? ALERTING_DEFAULT_GROUP_WAIT_SECS}s`,
    `interval ${timing.groupIntervalSecs ?? ALERTING_DEFAULT_GROUP_INTERVAL_SECS}s`,
    `repeat ${timing.repeatIntervalSecs != null ? `${timing.repeatIntervalSecs}s` : "never"}`,
    alertingGroupingSummary(timing.groupBy),
  ];
}
