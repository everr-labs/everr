import { createFileRoute, notFound } from "@tanstack/react-router";
import { DashboardNotFound } from "#app/components/dashboards/dashboard-not-found.tsx";
import { DashboardPanelPage } from "#app/components/dashboards/dashboard-panel-page.tsx";
import { DashboardProvider } from "#app/components/dashboards/use-dashboard.tsx";
import { getBuiltinDashboard } from "#app/data/dashboards/built-in/catalog/index.ts";
import { lastViewedDashboard } from "#app/data/dashboards/last-viewed.ts";
import { dashboardTimeDefaults } from "#app/data/dashboards/time-defaults.ts";
import { dashboardBreadcrumb } from "./-dashboard-route";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/dashboards/built-in/$slug/panel/$panelKey",
)({
  staticData: { breadcrumb: dashboardBreadcrumb },
  loader: ({ context: { session }, params: { slug, panelKey }, preload }) => {
    const builtin = getBuiltinDashboard(slug);
    if (!builtin) throw notFound();
    const panel = builtin.document.spec.panels[panelKey];
    if (!panel) throw notFound();
    if (!preload)
      lastViewedDashboard.record(session.session.activeOrganizationId, {
        kind: "built-in",
        slug,
      });
    return {
      name: builtin.name,
      panelName: panel.spec.display?.name ?? panelKey,
      timeDefaults: dashboardTimeDefaults(builtin.document.spec),
    };
  },
  component: BuiltinPanelRoutePage,
  notFoundComponent: DashboardNotFound,
  head: () => ({ meta: [{ title: "Everr - Built-in dashboard" }] }),
});

function BuiltinPanelRoutePage() {
  const { slug, panelKey } = Route.useParams();
  const builtin = getBuiltinDashboard(slug);
  // The loader already 404s unknown slugs and panel keys; this only narrows
  // the type.
  if (!builtin) throw notFound();
  const panel = builtin.document.spec.panels[panelKey];
  if (!panel) throw notFound();
  return (
    <DashboardProvider document={builtin.document}>
      <DashboardPanelPage panel={panel} panelKey={panelKey} />
    </DashboardProvider>
  );
}
