import { queryOptions } from "@tanstack/react-query";
import { getDashboard } from "./server";

export const dashboardOptions = (dashboardId: string) =>
  queryOptions({
    queryKey: ["dashboards", dashboardId],
    queryFn: () => getDashboard({ data: { dashboardId } }),
  });
