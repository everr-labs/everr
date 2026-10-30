import { productClient } from "@composition/client";
import { createFileRoute } from "@tanstack/react-router";
import gridLayoutCSS from "react-grid-layout/css/styles.css?url";
import { HomeSearchSchema } from "#app/common/onboarding.ts";
import gridLayoutOverridesCSS from "#app/components/dashboards/dashboard-grid.css?url";
import { DashboardHome } from "#app/components/home/dashboard-home.tsx";
import { HomeExperience } from "#app/components/home/home-experience.tsx";
import { getBuiltinDashboard } from "#app/data/dashboards/built-in/catalog/index.ts";
import { dashboardTimeDefaults } from "#app/data/dashboards/time-defaults.ts";

const homeDashboard = getBuiltinDashboard(productClient.homeDashboardId);
if (!homeDashboard) throw new Error(`Missing ${productClient.homeDashboardId} built-in dashboard`);
const homeDashboardDocument = homeDashboard.document;

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded/",
)({
  staticData: { breadcrumb: "Home" },
  validateSearch: HomeSearchSchema,
  loader: () => ({
    timeDefaults: dashboardTimeDefaults(homeDashboardDocument.spec),
  }),
  head: () => ({
    meta: [{ title: "Everr - Home" }],
    links: [
      { rel: "stylesheet", href: gridLayoutCSS },
      { rel: "stylesheet", href: gridLayoutOverridesCSS },
    ],
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
      <DashboardHome slug={productClient.homeDashboardId} document={homeDashboardDocument} />
    </HomeExperience>
  );
}
