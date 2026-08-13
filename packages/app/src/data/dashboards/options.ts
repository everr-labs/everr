import { queryOptions } from "@tanstack/react-query";
import type { PanelQuerySource } from "@/components/dashboards/query-array";
import type { QueryResultRow } from "@/components/dashboards/visualizations";
import { createLimiter } from "@/lib/limiter";
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

export const dashboardOptions = (
  project: string,
  slug: string,
  preview?: string,
) =>
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
 * Keyed by the exact range the previews use, so changing the time range
 * re-grades the catalog and re-renders the previews from the same window.
 * Kept fresh for a minute: readiness is a property of the data, not of the
 * document, and it moves when ingestion starts or stops.
 */
export const telemetryCapabilitiesOptions = (from: string, to: string) =>
  queryOptions({
    queryKey: [...dashboardsQueryKey, "capabilities", from, to],
    queryFn: () => getTelemetryCapabilities({ data: { from, to } }),
    staleTime: 60_000,
  });

export const panelQueryOptions = (
  source: PanelQuerySource,
  from?: string,
  to?: string,
  variables?: VariableValues,
  variableMeta?: VariableMeta,
) =>
  queryOptions({
    queryKey: [
      "panel-query",
      source,
      from,
      to,
      variables ?? null,
      variableMeta ?? null,
    ],
    queryFn: async ({ signal }): Promise<{ rows: QueryResultRow[] }> => {
      // `none` is never enabled, but the queryFn must still type-check.
      if (source.kind === "none") return { rows: [] };
      return panelLimiter(signal, () =>
        runPanelQuery({
          data: { source, from, to, variables, variableMeta },
        }),
      );
    },
    enabled:
      source.kind === "ClickHouseSQL"
        ? source.sql.trim().length > 0
        : source.kind === "TestData",
    // Data for a given (source, range, variables) key never goes stale on its
    // own: a panel that scrolls out of view and back must not refetch. Only an
    // explicit refresh (invalidateQueries, which overrides staleTime) or a key
    // change (range/variables) triggers a new fetch.
    staleTime: Number.POSITIVE_INFINITY,
  });

export const variableOptionsQueryOptions = (
  query: string,
  from?: string,
  to?: string,
) =>
  queryOptions({
    queryKey: ["variable-options", query, from, to],
    queryFn: () => runVariableOptionsQuery({ data: { query, from, to } }),
    enabled: query.trim().length > 0,
  });
