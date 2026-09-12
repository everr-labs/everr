import {
  isValidTimeRange,
  type TimeRange,
  timeRangeFromDuration,
} from "@everr/ui/lib/time-range";
import type {
  Dashboard,
  DashboardResource,
  DashboardResourceSpec,
} from "./schema";

function dashboardTimeRange(
  spec: Pick<DashboardResourceSpec, "duration" | "timeRange">,
): TimeRange | undefined {
  if (spec.timeRange && isValidTimeRange(spec.timeRange)) {
    return spec.timeRange;
  }
  return timeRangeFromDuration(spec.duration);
}

/**
 * Normalize a stored Perses-compatible resource into Everr's dashboard model.
 * Unknown fields remain intact, while the compatibility-only `duration` field
 * becomes the canonical `timeRange` representation used by the renderer.
 */
export function dashboardFromResource(document: DashboardResource): Dashboard {
  const { duration: _duration, timeRange: _timeRange, ...spec } = document.spec;
  const timeRange = dashboardTimeRange(document.spec);
  return {
    ...document,
    spec: {
      ...spec,
      ...(timeRange ? { timeRange } : {}),
    },
  };
}
