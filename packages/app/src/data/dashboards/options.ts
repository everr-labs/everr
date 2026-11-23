import { appQueryOptions, dataQueryOptions } from "@everr/ui/lib/query-options";
import { REFRESH_KEYED } from "@everr/ui/lib/refresh-epoch";
import { type TimeRange, toViewerTimeRange } from "@everr/ui/lib/time-range";
import type { QueryClient } from "@tanstack/react-query";
import type { PanelQuerySource } from "#app/components/dashboards/query-array.ts";
import type {
  QueryResultRow,
  ResolvedTimeRange,
} from "#app/components/dashboards/visualizations/index.tsx";
import { createLimiter } from "#app/lib/limiter.ts";
import type { VariableMeta, VariableValues } from "./interpolate";
import {
  getDashboard,
  getTelemetryCapabilities,
  listDashboards,
  runPanelQuery,
  runVariableOptionsQuery,
} from "./server";

const dashboardsQueryKey = ["dashboards"] as const;

// Cap how many panel queries run at once so a dashboard (or a grid of card
// previews) doesn't fire every panel's query simultaneously. Shared across all
// panels on the page; the rest queue and start in waves as slots free.
const MAX_CONCURRENT_PANEL_QUERIES = 4;
const panelLimiter = createLimiter(MAX_CONCURRENT_PANEL_QUERIES);

export const dashboardOptions = (project: string, slug: string, preview?: string) =>
  appQueryOptions({
    queryKey: [...dashboardsQueryKey, project, slug, preview ?? ""],
    queryFn: () => getDashboard({ data: { project, slug, preview } }),
    // The dashboard document is immutable (gitops); never auto-refetch it (e.g.
    // when a card preview re-enters the viewport). Refresh leaves it alone too,
    // as it reloads only data; a reload picks up an applied change.
    staleTime: Number.POSITIVE_INFINITY,
  });

export const dashboardListOptions = (preview?: string) =>
  appQueryOptions({
    queryKey: [...dashboardsQueryKey, "list", preview ?? ""],
    queryFn: () => listDashboards({ data: { preview } }),
  });

/**
 * Keyed by the exact range the dashboards render, so changing the time range
 * re-grades the built-in list from the same window. Readiness moves when
 * ingestion starts or stops, which is minutes-scale, and the probe scans every
 * signal table, so it stays fresh for five minutes rather than one.
 */
export const telemetryCapabilitiesOptions = (from: string, to: string) =>
  appQueryOptions({
    queryKey: [...dashboardsQueryKey, "capabilities", from, to],
    queryFn: () => getTelemetryCapabilities({ data: toViewerTimeRange({ from, to }) }),
    staleTime: 5 * 60_000,
  });

export const panelQueryOptions = (
  source: PanelQuerySource,
  /** The page's range, resolved at the instant every panel shares. */
  range: TimeRange,
  /** The page's refresh count, so a refresh refetches a range that resolves the same. */
  epoch: number,
  alignToStep: boolean,
  variables?: VariableValues,
  variableMeta?: VariableMeta,
) =>
  dataQueryOptions({
    queryKey: [
      "panel-query",
      source,
      range,
      epoch,
      alignToStep,
      variables ?? null,
      variableMeta ?? null,
    ],
    queryFn: async ({
      signal,
    }): Promise<{ rows: QueryResultRow[]; timeRange?: ResolvedTimeRange }> => {
      // `none` is never enabled, but the queryFn must still type-check.
      if (source.kind === "none") return { rows: [] };
      // The server returns the window rounded to whole seconds, and aligned
      // for a panel drawn over time, which the panel's axis renders.
      const { rows, timeRange } = await panelLimiter(signal, () =>
        runPanelQuery({
          data: {
            source,
            ...range,
            alignToStep,
            variables,
            variableMeta,
          },
        }),
      );
      return { rows, timeRange: { from: new Date(timeRange.from), to: new Date(timeRange.to) } };
    },
    enabled:
      source.kind === "ClickHouseSQL" ? source.sql.trim().length > 0 : source.kind === "TestData",
    // A panel that scrolls out of view and back must not refetch. A refresh
    // moves the instant the range is read at, which gives it a new key.
    ...REFRESH_KEYED,
  });

export const variableOptionsQueryOptions = (query: string, from?: string, to?: string) =>
  appQueryOptions({
    queryKey: ["variable-options", query, from, to],
    queryFn: () =>
      runVariableOptionsQuery({
        data: { query, ...toViewerTimeRange({ from, to }) },
      }),
    enabled: query.trim().length > 0,
  });

export const cachedDashboard = (
  queryClient: QueryClient,
  project: string,
  slug: string,
  preview?: string,
) => queryClient.getQueryData(dashboardOptions(project, slug, preview).queryKey);

/** From the cached document, else the cached list row; undefined on a cold deep link. */
export function cachedDashboardName(
  queryClient: QueryClient,
  project: string,
  slug: string,
  preview?: string,
): string | undefined {
  const dashboard = cachedDashboard(queryClient, project, slug, preview);
  if (dashboard) return dashboard.document.spec.display?.name ?? slug;
  return queryClient
    .getQueryData(dashboardListOptions(preview).queryKey)
    ?.find((row) => row.project === project && row.slug === slug)?.name;
}
