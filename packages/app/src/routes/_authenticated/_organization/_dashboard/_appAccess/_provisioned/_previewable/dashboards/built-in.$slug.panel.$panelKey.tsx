import { createFileRoute } from "@tanstack/react-router";
import { MaximizedPanel, PanelNotFound } from "#app/components/dashboards/maximized-panel.tsx";
import { getBuiltinDashboard } from "#app/data/dashboards/built-in/catalog/index.ts";
import { loadPanel, panelBreadcrumb } from "./-panel-route.ts";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/dashboards/built-in/$slug/panel/$panelKey",
)({
  staticData: { breadcrumb: panelBreadcrumb },
  loader: ({ params: { slug, panelKey } }) =>
    loadPanel(getBuiltinDashboard(slug)?.document.spec.panels, panelKey),
  component: PanelPage,
  notFoundComponent: PanelNotFoundPage,
});

function PanelPage() {
  const { slug, panelKey } = Route.useParams();
  return <MaximizedPanel address={{ kind: "built-in", slug }} panelKey={panelKey} />;
}

function PanelNotFoundPage() {
  const { slug } = Route.useParams();
  return <PanelNotFound address={{ kind: "built-in", slug }} />;
}
