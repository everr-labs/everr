import { isValid } from "@everr/datemath";
import type {
  Dashboard,
  DashboardResource,
  DashboardResourceSpec,
  DashboardSpec,
} from "./schema";

type DashboardTimeRange = NonNullable<DashboardSpec["timeRange"]>;

export function timeRangeFromDuration(
  duration: string | undefined,
): DashboardTimeRange | undefined {
  return duration && isValid(`now-${duration}`)
    ? { from: `now-${duration}`, to: "now" }
    : undefined;
}

function dashboardTimeRange(
  spec: Pick<DashboardResourceSpec, "duration" | "timeRange">,
): DashboardTimeRange | undefined {
  if (
    spec.timeRange &&
    isValid(spec.timeRange.from) &&
    isValid(spec.timeRange.to)
  ) {
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
