import { getBuiltinDashboard } from "@/data/dashboards/built-in/catalog";

const dashboard = getBuiltinDashboard("telemetry-usage");
if (!dashboard) throw new Error("Missing telemetry-usage built-in dashboard");

export const homeDashboardDocument = dashboard.document;
