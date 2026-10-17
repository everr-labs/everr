import { productClient } from "@composition/client";
import { createFileRoute } from "@tanstack/react-router";
import gridLayoutCSS from "react-grid-layout/css/styles.css?url";
import { HomeSearchSchema } from "@/common/onboarding";
import gridLayoutOverridesCSS from "@/components/dashboards/dashboard-grid.css?url";
import { DashboardHome } from "@/components/home/dashboard-home";
import { HomeExperience } from "@/components/home/home-experience";
import { getBuiltinDashboard } from "@/data/dashboards/built-in/catalog";
import { dashboardTimeDefaults } from "@/data/dashboards/time-defaults";

const homeDashboard = getBuiltinDashboard(productClient.homeDashboardId);
if (!homeDashboard)
  throw new Error(
    `Missing ${productClient.homeDashboardId} built-in dashboard`,
  );
const homeDashboardDocument = homeDashboard.document;

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded/",
)({
  staticData: { breadcrumb: "Home" },
  validateSearch: HomeSearchSchema,
  head: () => ({
    meta: [{ title: "Everr - Home" }],
    links: [
      { rel: "stylesheet", href: gridLayoutCSS },
      { rel: "stylesheet", href: gridLayoutOverridesCSS },
    ],
  }),
  loader: () => ({
    timeDefaults: dashboardTimeDefaults(homeDashboardDocument.spec),
  }),
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
      <DashboardHome document={homeDashboardDocument} />
    </HomeExperience>
  );
}
