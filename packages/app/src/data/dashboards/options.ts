import { queryOptions } from "@tanstack/react-query";
import { getDashboard, runPanelQuery } from "./server";

export const dashboardOptions = (dashboardId: string) =>
  queryOptions({
    queryKey: ["dashboards", dashboardId],
    queryFn: () => getDashboard({ data: { dashboardId } }),
  });

export const panelQueryOptions = (sql: string) =>
  queryOptions({
    queryKey: ["panel-query", sql],
    queryFn: () => runPanelQuery({ data: { sql } }),
    enabled: sql.trim().length > 0,
  });
