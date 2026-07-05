import { resolveTimeRange, type TimeRange, toClickHouseDateTime } from "@everr/ui/lib/time-range";
import type { LogsRepositoryLike } from "../../logs/data/repository";
import type { TracesRepositoryLike } from "../../traces/data/repository";
import { ENVIRONMENT_ATTRIBUTE } from "../ui/dedicated-attributes";

// The Explore Service/Environment filters are shared params that persist across
// the Logs/Errors/Traces views, so their option lists must be view-independent
// too: a service that only emits traces should still be selectable while you are
// on Logs. These builders union the values across both signals (logs + traces;
// errors are exception logs, a subset of logs) so the dropdowns are identical
// wherever you are. `selected` is folded in so a chosen value never disappears
// from the list just because it has aged out of the current time range.
function mergeOptions(...lists: string[][]): string[] {
  return Array.from(new Set(lists.flat().filter((value) => value.length > 0))).sort((a, b) =>
    a.localeCompare(b),
  );
}

export function unionServiceOptions(
  logsRepo: LogsRepositoryLike,
  tracesRepo: TracesRepositoryLike,
  input: { timeRange: TimeRange; selected: string[] },
) {
  return {
    queryKey: ["explore", "union-service-options", input.timeRange] as const,
    queryFn: async () => {
      const { fromDate, toDate } = resolveTimeRange(input.timeRange);
      const [logOptions, traceIdentities] = await Promise.all([
        logsRepo.filterOptions({ timeRange: input.timeRange }),
        tracesRepo.listServiceIdentities({
          fromTs: toClickHouseDateTime(fromDate),
          toTs: toClickHouseDateTime(toDate),
        }),
      ]);
      return mergeOptions(
        logOptions.services,
        traceIdentities.map((identity) => identity.serviceName),
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
) {
  const attributeInput = {
    timeRange: input.timeRange,
    source: ENVIRONMENT_ATTRIBUTE.source,
    key: ENVIRONMENT_ATTRIBUTE.key,
  };
  return {
    queryKey: ["explore", "union-environment-options", input.timeRange] as const,
    queryFn: async () => {
      const [logEnvironments, traceEnvironments] = await Promise.all([
        logsRepo.attributeValues(attributeInput),
        tracesRepo.attributeValues(attributeInput),
      ]);
      return mergeOptions(logEnvironments, traceEnvironments);
    },
    select: (data: string[]) => mergeOptions(data, input.selected),
  };
}
