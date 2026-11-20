import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import { toViewerTimeRange, withViewerTimeRange } from "@everr/ui/lib/time-range";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { MetricsRepositoryLike } from "./repository";
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

function refetchInterval(refresh: string) {
  const ms = getRefreshIntervalMs(refresh);
  return ms && ms > 0 ? ms : false;
}

export function metricCatalogOptions(
  repo: MetricsRepositoryLike,
  input: MetricCatalogInput,
  refresh: string,
) {
  return queryOptions({
    queryKey: ["metrics", "catalog", input] as const,
    queryFn: () => repo.catalog(withViewerTimeRange(input)),
    placeholderData: keepPreviousData,
    refetchInterval: refetchInterval(refresh),
  });
}

// Unit, description and temporality don't change between refreshes, so
// neither query refetches with the page.
export function metricMetadataOptions(repo: MetricsRepositoryLike, input: MetricMetadataInput) {
  return queryOptions({
    queryKey: ["metrics", "metadata", input] as const,
    queryFn: () => repo.metadata(withViewerTimeRange(input)),
  });
}

export function metricNamesOptions(repo: MetricsRepositoryLike, input: MetricNamesInput) {
  return queryOptions({
    queryKey: ["metrics", "names", input] as const,
    queryFn: () => repo.names(withViewerTimeRange(input)),
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
    queryFn: () => repo.kinds(withViewerTimeRange(input)),
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
  refresh: string,
) {
  return queryOptions({
    queryKey: ["metrics", "series", inputs] as const,
    queryFn: () => {
      const now = new Date();
      return Promise.all(
        inputs.map(async (input) => {
          return input
            ? repo.series({ ...input, timeRange: toViewerTimeRange(input.timeRange, now) })
            : null;
        }),
      );
    },
    refetchInterval: refetchInterval(refresh),
  });
}

export function metricExemplarsOptions(
  repo: MetricsRepositoryLike,
  input: MetricExemplarsInput,
  refresh: string,
) {
  return queryOptions({
    queryKey: ["metrics", "exemplars", input] as const,
    queryFn: () => repo.exemplars(withViewerTimeRange(input)),
    refetchInterval: refetchInterval(refresh),
  });
}

export function metricSummaryQuantilesOptions(
  repo: MetricsRepositoryLike,
  input: MetricSummaryQuantilesInput,
) {
  return queryOptions({
    queryKey: ["metrics", "summary-quantiles", input] as const,
    queryFn: () => repo.summaryQuantiles(withViewerTimeRange(input)),
  });
}

export function metricExportIntervalOptions(
  repo: MetricsRepositoryLike,
  input: MetricExportIntervalInput,
) {
  return queryOptions({
    queryKey: ["metrics", "export-interval", input] as const,
    queryFn: () => repo.exportInterval(withViewerTimeRange(input)),
  });
}
