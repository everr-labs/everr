import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { DashboardNotFound } from "#app/components/dashboards/dashboard-not-found.tsx";
import { DashboardPanelPage } from "#app/components/dashboards/dashboard-panel-page.tsx";
import { DashboardProvider } from "#app/components/dashboards/use-dashboard.tsx";
import { dashboardOptions } from "#app/data/dashboards/options.ts";
import { dashboardBreadcrumb, dashboardHead, loadDashboard } from "./-dashboard-route";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/dashboards/$project/$slug/panel/$panelKey",
)({
  staticData: { breadcrumb: dashboardBreadcrumb },
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  component: DashboardPanelRoutePage,
  notFoundComponent: DashboardNotFound,
  loader: async ({
    context: { queryClient, session },
    params: { project, slug, panelKey },
    deps: { preview },
    preload,
  }) =>
    loadDashboard({
      queryClient,
      session,
      project,
      slug,
      preview,
      preload,
      panelKey,
    }),
  head: dashboardHead,
});

function DashboardPanelRoutePage() {
  const { project, slug, panelKey } = Route.useParams();
  const { preview } = Route.useSearch();
  const {
    data: { document },
  } = useSuspenseQuery(dashboardOptions(project, slug, preview));
  const panel = document.spec.panels[panelKey];
  // The loader already 404s unknown keys (panelName); this only narrows the
  // type on the client read of the same immutable cache.
  if (!panel) throw notFound();
  return (
    <DashboardProvider document={document}>
      <DashboardPanelPage panel={panel} panelKey={panelKey} />
    </DashboardProvider>
  );
}
