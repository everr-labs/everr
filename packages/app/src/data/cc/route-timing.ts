import {
  CC_DEFAULT_GROUP_BY,
  CC_DEFAULT_GROUP_INTERVAL_SECS,
  CC_DEFAULT_GROUP_WAIT_SECS,
} from "./defaults";

export type CcRouteTiming = {
  groupBy: string[] | null;
  groupWaitSecs: number | null;
  groupIntervalSecs: number | null;
  repeatIntervalSecs: number | null;
};

/**
 * Timing parts for one route (callers join with " · "). `overrides`: only
 * explicitly set values, empty when the route rides engine defaults;
 * `effective`: every slot filled, engine defaults where unset.
 */
export function ccRouteTimingSummary(
  timing: CcRouteTiming,
  mode: "overrides" | "effective",
): string[] {
  const groupBy = timing.groupBy ?? [];
  if (mode === "overrides") {
    const parts: string[] = [];
    if (groupBy.length > 0) parts.push(`group by ${groupBy.join(", ")}`);
    if (timing.groupWaitSecs != null)
      parts.push(`wait ${timing.groupWaitSecs}s`);
    if (timing.groupIntervalSecs != null)
      parts.push(`interval ${timing.groupIntervalSecs}s`);
    if (timing.repeatIntervalSecs != null)
      parts.push(`repeat ${timing.repeatIntervalSecs}s`);
    return parts;
  }
  return [
    `wait ${timing.groupWaitSecs ?? CC_DEFAULT_GROUP_WAIT_SECS}s`,
    `interval ${timing.groupIntervalSecs ?? CC_DEFAULT_GROUP_INTERVAL_SECS}s`,
    `repeat ${timing.repeatIntervalSecs != null ? `${timing.repeatIntervalSecs}s` : "never"}`,
    `group by ${(groupBy.length > 0 ? groupBy : CC_DEFAULT_GROUP_BY).join(", ")}`,
  ];
}
