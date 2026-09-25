import { createFileRoute } from "@tanstack/react-router";
import gridLayoutCSS from "react-grid-layout/css/styles.css?url";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import gridLayoutOverridesCSS from "@/components/dashboards/dashboard-grid.css?url";
import { DashboardProvider } from "@/components/dashboards/use-dashboard";
import { InstallEverrCard } from "@/components/home/setup-cards";
import { getBuiltinDashboard } from "@/data/dashboards/built-in/catalog";
import { dashboardTimeDefaults } from "@/data/dashboards/time-defaults";

// Home is the Telemetry Usage built-in, rendered live from the catalog like
// any other built-in dashboard.
const usage = getBuiltinDashboard("telemetry-usage");
if (!usage) throw new Error("Missing telemetry-usage built-in dashboard");
const usageDocument = usage.document;

export const Route = createFileRoute("/_authenticated/_dashboard/_padded/")({
  staticData: { breadcrumb: "Home" },
  head: () => ({
    meta: [{ title: "Everr - Home" }],
    links: [
      { rel: "stylesheet", href: gridLayoutCSS },
      { rel: "stylesheet", href: gridLayoutOverridesCSS },
    ],
  }),
  loader: () => ({ timeDefaults: dashboardTimeDefaults(usageDocument.spec) }),
  component: HomePage,
});

function HomePage() {
  return (
    <div className="space-y-6">
      <InstallEverrCard />
      <DashboardProvider document={usageDocument}>
        <DashboardGrid frameToggle={false} />
      </DashboardProvider>
    </div>
  );
}
