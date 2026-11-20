import { getRefreshIntervalMs } from "@everr/ui/components/refresh-picker";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { MetricsRepositoryLike } from "./repository";
import { MetricKindSchema } from "./schemas";
import { metricKind, type MetricNameEntry } from "./types";
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
    queryFn: () => repo.catalog(input),
    placeholderData: keepPreviousData,
    refetchInterval: refetchInterval(refresh),
  });
}

// Unit, description and temporality don't change between refreshes, so
// neither query refetches with the page.
export function metricMetadataOptions(repo: MetricsRepositoryLike, input: MetricMetadataInput) {
  return queryOptions({
    queryKey: ["metrics", "metadata", input] as const,
    queryFn: () => repo.metadata(input),
  });
}

export function metricNamesOptions(repo: MetricsRepositoryLike, input: MetricNamesInput) {
  return queryOptions({
    queryKey: ["metrics", "names", input] as const,
    queryFn: () => repo.names(input),
    placeholderData: keepPreviousData,
  });
}

/**
 * The kinds among the metrics in range, for the catalog's Type filter. It
 * reads the names query, so it lists only kinds with data, like Service and
 * Environment, and shares its cache with the metric switcher.
 */
export function metricKindOptions(repo: MetricsRepositoryLike, input: MetricNamesInput) {
  return {
    queryKey: ["metrics", "names", input] as const,
    queryFn: () => repo.names(input),
    select: (metrics: MetricNameEntry[]): string[] => {
      const present = new Set(metrics.map((m) => metricKind(m.type, m.isMonotonic)));
      return MetricKindSchema.options.filter((kind) => present.has(kind));
    },
  };
}

export function metricSeriesOptions(
  repo: MetricsRepositoryLike,
  input: MetricSeriesInput,
  refresh: string,
) {
  return queryOptions({
    queryKey: ["metrics", "series", input] as const,
    queryFn: () => repo.series(input),
    // Keep the chart while the same metric refetches with other filters, but
    // never show one metric's lines under another's name.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2].metric === input.metric ? previous : undefined,
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
    queryFn: () => repo.exemplars(input),
    refetchInterval: refetchInterval(refresh),
  });
}

export function metricSummaryQuantilesOptions(
  repo: MetricsRepositoryLike,
  input: MetricSummaryQuantilesInput,
) {
  return queryOptions({
    queryKey: ["metrics", "summary-quantiles", input] as const,
    queryFn: () => repo.summaryQuantiles(input),
    // An SDK's configured quantiles rarely change; keep them across refreshes
    // so the aggregation picker doesn't flicker.
    placeholderData: keepPreviousData,
  });
}

export function metricExportIntervalOptions(
  repo: MetricsRepositoryLike,
  input: MetricExportIntervalInput,
) {
  return queryOptions({
    queryKey: ["metrics", "export-interval", input] as const,
    queryFn: () => repo.exportInterval(input),
  });
}
