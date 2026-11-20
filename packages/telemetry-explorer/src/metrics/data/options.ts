import { inViewerTimeRange } from "@everr/ui/lib/time-range";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { MetricsRepositoryLike } from "./repository";
import type { MetricSeriesResult } from "./types";
import { MetricKindSchema } from "./schemas";
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
 * Every query of one chart, fetched together over one absolute range. Each
 * request resolving `now` on its own would start its buckets at another
 * minute, so a query fetched later would be drawn shifted against the rest.
 * A `null` input is a query with nothing to fetch yet.
 */
export function metricSeriesOptions(
  repo: MetricsRepositoryLike,
  inputs: readonly (MetricSeriesInput | null)[],
) {
  return queryOptions({
    queryKey: ["metrics", "series", inputs] as const,
    queryFn: () => {
      const now = new Date();
      return Promise.all(
        inputs.map(async (input) => {
          return input
            ? inViewerTimeRange(
                input.timeRange,
                NO_SERIES,
                (timeRange) => repo.series({ ...input, timeRange }),
                now,
              )
            : null;
        }),
      );
    },
  });
}

export function metricExemplarsOptions(repo: MetricsRepositoryLike, input: MetricExemplarsInput) {
  return queryOptions({
    queryKey: ["metrics", "exemplars", input] as const,
    queryFn: () =>
      inViewerTimeRange(input.timeRange, [], (timeRange) =>
        repo.exemplars({ ...input, timeRange }),
      ),
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
