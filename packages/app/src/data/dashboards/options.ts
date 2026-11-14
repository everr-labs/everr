import { DEFAULT_TIME_RANGE, resolveTimeRange } from "@everr/ui/lib/time-range";
import { queryOptions } from "@tanstack/react-query";
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
  queryOptions({
    queryKey: [...dashboardsQueryKey, project, slug, preview ?? ""],
    queryFn: () => getDashboard({ data: { project, slug, preview } }),
    // The dashboard document is immutable (gitops); never auto-refetch it (e.g.
    // when a card preview re-enters the viewport). A manual refresh still
    // invalidates it.
    staleTime: Number.POSITIVE_INFINITY,
  });

export const dashboardListOptions = (preview?: string) =>
  queryOptions({
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
  queryOptions({
    queryKey: [...dashboardsQueryKey, "capabilities", from, to],
    queryFn: () => getTelemetryCapabilities({ data: { from, to } }),
    staleTime: 5 * 60_000,
  });

export const panelQueryOptions = (
  source: PanelQuerySource,
  from?: string,
  to?: string,
  variables?: VariableValues,
  variableMeta?: VariableMeta,
) =>
  queryOptions({
    queryKey: ["panel-query", source, from, to, variables ?? null, variableMeta ?? null],
    queryFn: async ({
      signal,
    }): Promise<{ rows: QueryResultRow[]; timeRange: ResolvedTimeRange }> =>
      panelLimiter(signal, async () => {
        // The key keeps the relative range (`now-1h`) so a refresh hits the
        // same cache entry, but each fetch pins it to exact dates here: the
        // server queries that window and the panel's axis renders it, so the
        // two can't drift apart. Resolved after the limiter's queue wait so
        // the window is current when the query actually runs.
        const { fromDate, toDate } = resolveTimeRange({
          from: from ?? DEFAULT_TIME_RANGE.from,
          to: to ?? DEFAULT_TIME_RANGE.to,
        });
        const timeRange = { from: fromDate, to: toDate };
        // `none` is never enabled, but the queryFn must still type-check.
        if (source.kind === "none") return { rows: [], timeRange };
        const { rows } = await runPanelQuery({
          data: {
            source,
            from: fromDate.toISOString(),
            to: toDate.toISOString(),
            variables,
            variableMeta,
          },
        });
        return { rows, timeRange };
      }),
    enabled:
      source.kind === "ClickHouseSQL" ? source.sql.trim().length > 0 : source.kind === "TestData",
    // Data for a given (source, range, variables) key never goes stale on its
    // own: a panel that scrolls out of view and back must not refetch. Only an
    // explicit refresh (invalidateQueries, which overrides staleTime) or a key
    // change (range/variables) triggers a new fetch.
    staleTime: Number.POSITIVE_INFINITY,
  });

export const variableOptionsQueryOptions = (query: string, from?: string, to?: string) =>
  queryOptions({
    queryKey: ["variable-options", query, from, to],
    queryFn: () => runVariableOptionsQuery({ data: { query, from, to } }),
    enabled: query.trim().length > 0,
  });
