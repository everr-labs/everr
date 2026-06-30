import { queryOptions } from "@tanstack/react-query";
import type { PanelQuerySource } from "@/components/dashboards/query-array";
import type { QueryResultRow } from "@/components/dashboards/visualizations";
import type { VariableMeta, VariableValues } from "./interpolate";
import {
  getDashboard,
  listDashboards,
  runPanelQuery,
  runVariableOptionsQuery,
} from "./server";

const dashboardsQueryKey = ["dashboards"] as const;

export const dashboardOptions = (project: string, slug: string) =>
  queryOptions({
    queryKey: [...dashboardsQueryKey, project, slug],
    queryFn: () => getDashboard({ data: { project, slug } }),
    // The dashboard document is immutable (gitops); never auto-refetch it (e.g.
    // when a card preview re-enters the viewport). A manual refresh still
    // invalidates it.
    staleTime: Number.POSITIVE_INFINITY,
  });

export const dashboardListOptions = () =>
  queryOptions({
    queryKey: [...dashboardsQueryKey, "list"],
    queryFn: () => listDashboards(),
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
    queryFn: async (): Promise<{ rows: QueryResultRow[] }> => {
      // `none` is never enabled, but the queryFn must still type-check.
      if (source.kind === "none") return { rows: [] };
      return runPanelQuery({
        data: { source, from, to, variables, variableMeta },
      });
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
