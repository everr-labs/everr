import { getBuiltinDashboard } from "@/data/dashboards/built-in/catalog";

const dashboard = getBuiltinDashboard("traces-overview");
if (!dashboard) throw new Error("Missing traces-overview built-in dashboard");

export const homeDashboardDocument = dashboard.document;
