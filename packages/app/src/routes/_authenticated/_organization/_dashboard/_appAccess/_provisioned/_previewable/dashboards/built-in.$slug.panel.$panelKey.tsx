import { createFileRoute, notFound } from "@tanstack/react-router";
import { MaximizedPanel, PanelNotFound } from "#app/components/dashboards/maximized-panel.tsx";
import { getBuiltinDashboard } from "#app/data/dashboards/built-in/catalog/index.ts";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/dashboards/built-in/$slug/panel/$panelKey",
)({
  // Appended to the dashboard's own crumbs, which turns the dashboard name
  // into the way back.
  staticData: {
    breadcrumb: (match: { loaderData?: { panelName: string } }) =>
      match.loaderData?.panelName ?? "Panel",
  },
  loader: ({ params: { slug, panelKey } }) => {
    const panel = getBuiltinDashboard(slug)?.document.spec.panels[panelKey];
    if (!panel) throw notFound();
    return { panelName: panel.spec.display?.name ?? panelKey };
  },
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
