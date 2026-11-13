import { createFileRoute, Link, notFound, Outlet } from "@tanstack/react-router";
import gridLayoutCSS from "react-grid-layout/css/styles.css?url";
import gridLayoutOverridesCSS from "#app/components/dashboards/dashboard-grid.css?url";
import { DashboardNotFound } from "#app/components/dashboards/dashboard-not-found.tsx";
import { DashboardProvider } from "#app/components/dashboards/use-dashboard.tsx";
import { getBuiltinDashboard } from "#app/data/dashboards/built-in/catalog/index.ts";
import { lastViewedDashboard } from "#app/data/dashboards/last-viewed.ts";
import { dashboardTimeDefaults } from "#app/data/dashboards/time-defaults.ts";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/dashboards/built-in/$slug",
)({
  staticData: {
    breadcrumb: (match: { loaderData?: { name: string } }) => [
      { label: "Dashboards", link: <Link to="/dashboards" /> },
      { label: match.loaderData?.name ?? "Built-in dashboard" },
    ],
  },
  loader: ({ context: { session }, params: { slug }, preload }) => {
    const builtin = getBuiltinDashboard(slug);
    if (!builtin) throw notFound();
    // Preloads (link hover) run this loader too; only a committed navigation
    // counts as "viewed".
    if (!preload)
      lastViewedDashboard.record(session.session.activeOrganizationId, {
        kind: "built-in",
        slug,
      });
    return {
      name: builtin.name,
      timeDefaults: dashboardTimeDefaults(builtin.document.spec),
    };
  },
  component: BuiltinDashboardLayout,
  notFoundComponent: DashboardNotFound,
  head: () => ({
    meta: [{ title: "Everr - Built-in dashboard" }],
    links: [
      { rel: "stylesheet", href: gridLayoutCSS },
      { rel: "stylesheet", href: gridLayoutOverridesCSS },
    ],
  }),
});

/**
 * Layout for the grid (index) and the maximized-panel page below it: both draw
 * the same catalog document, so the loader, the time defaults and the provider
 * live here once.
 */
function BuiltinDashboardLayout() {
  const { slug } = Route.useParams();
  const builtin = getBuiltinDashboard(slug);
  // The loader already 404s unknown slugs; this only narrows the type.
  if (!builtin) throw notFound();
  return (
    <DashboardProvider document={builtin.document}>
      <Outlet />
    </DashboardProvider>
  );
}
