import { queryOptions } from "@tanstack/react-query";
import { getDashboard, runPanelQuery } from "./server";

export const dashboardOptions = (dashboardId: string) =>
  queryOptions({
    queryKey: ["dashboards", dashboardId],
    queryFn: () => getDashboard({ data: { dashboardId } }),
  });

export const panelQueryOptions = (sql: string, from?: string, to?: string) =>
  queryOptions({
    queryKey: ["panel-query", sql, from, to],
    queryFn: () => runPanelQuery({ data: { sql, from, to } }),
    enabled: sql.trim().length > 0,
  });
