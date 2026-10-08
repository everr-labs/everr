import { createFileRoute } from "@tanstack/react-router";
import gridLayoutCSS from "react-grid-layout/css/styles.css?url";
import { HomeSearchSchema } from "@/common/onboarding";
import { DashboardGrid } from "@/components/dashboards/dashboard-grid";
import gridLayoutOverridesCSS from "@/components/dashboards/dashboard-grid.css?url";
import { DashboardProvider } from "@/components/dashboards/use-dashboard";
import { HomeExperience } from "@/components/home/home-experience";
import { getBuiltinDashboard } from "@/data/dashboards/built-in/catalog";
import { dashboardTimeDefaults } from "@/data/dashboards/time-defaults";

// The ordinary Home renders the Telemetry Usage built-in from the catalog.
const usage = getBuiltinDashboard("telemetry-usage");
if (!usage) throw new Error("Missing telemetry-usage built-in dashboard");
const usageDocument = usage.document;

export const Route = createFileRoute("/_authenticated/_dashboard/_padded/")({
  staticData: { breadcrumb: "Home" },
  validateSearch: HomeSearchSchema,
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
  const { session } = Route.useRouteContext();
  const { setup } = Route.useSearch();
  return (
    <HomeExperience
      userId={session.user.id}
      organizationId={session.session.activeOrganizationId}
      setupRequested={setup === 1}
    >
      <DashboardProvider document={usageDocument}>
        <DashboardGrid frameToggle={false} />
      </DashboardProvider>
    </HomeExperience>
  );
}
