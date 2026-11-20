import { type TimeRange, toClickHouseDateTime, toViewerTimeRange } from "@everr/ui/lib/time-range";
import type { LogsRepositoryLike } from "../../logs/data/repository";
import type { MetricsRepositoryLike } from "../../metrics/data/repository";
import type { TracesRepositoryLike } from "../../traces/data/repository";
import { ENVIRONMENT_ATTRIBUTE } from "../ui/dedicated-attributes";

// The Explore Service/Environment filters are shared params that persist across
// the Logs/Errors/Traces/Metrics views, so their option lists must be
// view-independent too: a service that only emits traces should still be
// selectable while you are on Logs. These builders union the values across the
// signals (logs + traces + metrics when the host has them; errors are exception
// logs, a subset of logs) so the dropdowns are identical wherever you are. `selected` is folded in so a chosen value never disappears
// from the list just because it has aged out of the current time range.
function mergeOptions(...lists: string[][]): string[] {
  return Array.from(new Set(lists.flat().filter((value) => value.length > 0))).sort((a, b) =>
    a.localeCompare(b),
  );
}

/** Metrics are optional: the CLI's local explorer has no Metrics page yet. */
type MetricsFilterSource = Pick<MetricsRepositoryLike, "services" | "environments">;

export function unionServiceOptions(
  logsRepo: LogsRepositoryLike,
  tracesRepo: TracesRepositoryLike,
  input: { timeRange: TimeRange; selected: string[] },
  metricsRepo?: MetricsFilterSource,
) {
  return {
    queryKey: ["explore", "union-service-options", input.timeRange, Boolean(metricsRepo)] as const,
    queryFn: async () => {
      const timeRange = toViewerTimeRange(input.timeRange);
      const [logOptions, traceIdentities, metricServices] = await Promise.all([
        logsRepo.filterOptions({ timeRange }),
        tracesRepo.listServiceIdentities({
          fromTs: toClickHouseDateTime(new Date(timeRange.from)),
          toTs: toClickHouseDateTime(new Date(timeRange.to)),
        }),
        metricsRepo?.services({ timeRange }) ?? [],
      ]);
      return mergeOptions(
        logOptions.services,
        traceIdentities.map((identity) => identity.serviceName),
        metricServices,
      );
    },
    // Fold selected values in here (not in queryFn) so a chosen-but-aged-out
    // service stays listed without forcing a refetch when the selection changes.
    select: (data: string[]) => mergeOptions(data, input.selected),
  };
}

export function unionEnvironmentOptions(
  logsRepo: LogsRepositoryLike,
  tracesRepo: TracesRepositoryLike,
  input: { timeRange: TimeRange; selected: string[] },
  metricsRepo?: MetricsFilterSource,
) {
  return {
    queryKey: [
      "explore",
      "union-environment-options",
      input.timeRange,
      Boolean(metricsRepo),
    ] as const,
    queryFn: async () => {
      const timeRange = toViewerTimeRange(input.timeRange);
      const attributeInput = {
        timeRange,
        source: ENVIRONMENT_ATTRIBUTE.source,
        key: ENVIRONMENT_ATTRIBUTE.key,
      };
      const [logEnvironments, traceEnvironments, metricEnvironments] = await Promise.all([
        logsRepo.attributeValues(attributeInput),
        tracesRepo.attributeValues(attributeInput),
        metricsRepo?.environments({ timeRange }) ?? [],
      ]);
      return mergeOptions(logEnvironments, traceEnvironments, metricEnvironments);
    },
    select: (data: string[]) => mergeOptions(data, input.selected),
  };
}
