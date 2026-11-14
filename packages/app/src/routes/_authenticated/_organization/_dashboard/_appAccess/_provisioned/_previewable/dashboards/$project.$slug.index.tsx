import { createFileRoute } from "@tanstack/react-router";
import { DashboardGrid } from "#app/components/dashboards/dashboard-grid.tsx";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/dashboards/$project/$slug/",
)({
  // Carries the dashboard toolbar and its list toggle (see RailFrame).
  staticData: { railToggle: true },
  component: DashboardPage,
});

function DashboardPage() {
  const { project, slug } = Route.useParams();
  return <DashboardGrid address={{ kind: "own", project, slug }} />;
}
