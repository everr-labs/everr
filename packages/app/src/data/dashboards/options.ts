import { queryOptions } from "@tanstack/react-query";
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
  });

export const dashboardListOptions = () =>
  queryOptions({
    queryKey: [...dashboardsQueryKey, "list"],
    queryFn: () => listDashboards(),
  });

export const panelQueryOptions = (
  sql: string,
  from?: string,
  to?: string,
  variables?: VariableValues,
  variableMeta?: VariableMeta,
) =>
  queryOptions({
    queryKey: [
      "panel-query",
      sql,
      from,
      to,
      variables ?? null,
      variableMeta ?? null,
    ],
    queryFn: () =>
      runPanelQuery({ data: { sql, from, to, variables, variableMeta } }),
    enabled: sql.trim().length > 0,
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
