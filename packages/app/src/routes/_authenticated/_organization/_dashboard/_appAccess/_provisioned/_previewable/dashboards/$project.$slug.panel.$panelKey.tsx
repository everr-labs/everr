import { createFileRoute } from "@tanstack/react-router";
import { MaximizedPanel, PanelNotFound } from "#app/components/dashboards/maximized-panel.tsx";
import { dashboardOptions } from "#app/data/dashboards/options.ts";
import { loadPanel, panelBreadcrumb } from "./-panel-route.ts";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/dashboards/$project/$slug/panel/$panelKey",
)({
  staticData: { breadcrumb: panelBreadcrumb },
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  // Same query the dashboard layout above ensures, so this costs no request.
  loader: async ({
    context: { queryClient },
    params: { project, slug, panelKey },
    deps: { preview },
  }) => {
    const { document } = await queryClient.ensureQueryData(
      dashboardOptions(project, slug, preview),
    );
    return loadPanel(document.spec.panels, panelKey);
  },
  component: PanelPage,
  notFoundComponent: PanelNotFoundPage,
});

function PanelPage() {
  const { project, slug, panelKey } = Route.useParams();
  return <MaximizedPanel address={{ kind: "own", project, slug }} panelKey={panelKey} />;
}

function PanelNotFoundPage() {
  const { project, slug } = Route.useParams();
  return <PanelNotFound address={{ kind: "own", project, slug }} />;
}
