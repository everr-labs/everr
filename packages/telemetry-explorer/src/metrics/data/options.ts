import { REFRESH_KEYED } from "@everr/ui/lib/refresh-epoch";
import { inViewerTimeRange, type TimeRange } from "@everr/ui/lib/time-range";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { MetricsRepositoryLike } from "./repository";
import type { MetricSeriesResult } from "./types";
import { MetricKindSchema } from "./schemas";
import { type ChartClock, clockNow } from "./step";
import type {
  MetricCatalogInput,
  MetricNamesInput,
  MetricExemplarsInput,
  MetricExportIntervalInput,
  MetricMetadataInput,
  MetricSeriesInput,
  MetricSummaryQuantilesInput,
} from "./schemas";

const NO_SERIES: MetricSeriesResult = { stepSeconds: 60, buckets: [], series: [], totalSeries: 0 };

export function metricCatalogOptions(repo: MetricsRepositoryLike, input: MetricCatalogInput) {
  return queryOptions({
    queryKey: ["metrics", "catalog", input] as const,
    queryFn: () =>
      inViewerTimeRange(input.timeRange, [], (timeRange) => repo.catalog({ ...input, timeRange })),
    placeholderData: keepPreviousData,
  });
}

export function metricMetadataOptions(repo: MetricsRepositoryLike, input: MetricMetadataInput) {
  return queryOptions({
    queryKey: ["metrics", "metadata", input] as const,
    queryFn: () =>
      inViewerTimeRange(input.timeRange, null, (timeRange) =>
        repo.metadata({ ...input, timeRange }),
      ),
  });
}

export function metricNamesOptions(repo: MetricsRepositoryLike, input: MetricNamesInput) {
  return queryOptions({
    queryKey: ["metrics", "names", input] as const,
    queryFn: () =>
      inViewerTimeRange(input.timeRange, [], (timeRange) => repo.names({ ...input, timeRange })),
    placeholderData: keepPreviousData,
  });
}

/**
 * The kinds of metric in range, for the catalog's Type filter, so it lists
 * only kinds with data, like Service and Environment. Selected kinds stay
 * listed without data, so they can be unticked.
 */
export function metricKindOptions(
  repo: MetricsRepositoryLike,
  input: MetricNamesInput,
  selected: readonly string[],
) {
  return {
    queryKey: ["metrics", "kinds", input] as const,
    queryFn: () =>
      inViewerTimeRange(input.timeRange, [], (timeRange) => repo.kinds({ ...input, timeRange })),
    select: (kinds: string[]): string[] => {
      const present = new Set([...kinds, ...selected]);
      return MetricKindSchema.options.filter((kind) => present.has(kind));
    },
  };
}

/**
 * One query of a chart, read on the chart's clock: queries with the same
 * clock share a grid, so each can stay cached while another changes, and a
 * copy of a query reads its source's data.
 */
/** Reads a chart query's range at the chart clock's instant, with its step. */
function onClock<I extends { timeRange: TimeRange }, R>(
  input: I,
  clock: ChartClock,
  empty: R,
  read: (input: I & { step: number }) => Promise<R>,
): Promise<R> {
  return inViewerTimeRange(
    input.timeRange,
    empty,
    (timeRange) => read({ ...input, timeRange, step: clock.step }),
    clockNow(clock),
  );
}

export function metricSeriesOptions(
  repo: MetricsRepositoryLike,
  input: Omit<MetricSeriesInput, "step">,
  clock: ChartClock,
) {
  return queryOptions({
    queryKey: ["metrics", "series", input, clock] as const,
    queryFn: () =>
      onClock(input, clock, NO_SERIES, async (read) => {
        const result = await repo.series(read);
        return clock.fromExport ? { ...result, stepFromExport: true } : result;
      }),
    ...REFRESH_KEYED,
  });
}

/** The exemplars of a chart's single query, on the chart's clock so they land on its buckets. */
export function metricExemplarsOptions(
  repo: MetricsRepositoryLike,
  input: Omit<MetricExemplarsInput, "step">,
  clock: ChartClock,
) {
  return queryOptions({
    queryKey: ["metrics", "exemplars", input, clock] as const,
    queryFn: () => onClock(input, clock, [], (read) => repo.exemplars(read)),
    ...REFRESH_KEYED,
  });
}

export function metricSummaryQuantilesOptions(
  repo: MetricsRepositoryLike,
  input: MetricSummaryQuantilesInput,
) {
  return queryOptions({
    queryKey: ["metrics", "summary-quantiles", input] as const,
    queryFn: () =>
      inViewerTimeRange(input.timeRange, [], (timeRange) =>
        repo.summaryQuantiles({ ...input, timeRange }),
      ),
  });
}

export function metricExportIntervalOptions(
  repo: MetricsRepositoryLike,
  input: MetricExportIntervalInput,
) {
  return queryOptions({
    queryKey: ["metrics", "export-interval", input] as const,
    queryFn: () =>
      inViewerTimeRange(input.timeRange, null, (timeRange) =>
        repo.exportInterval({ ...input, timeRange }),
      ),
  });
}
