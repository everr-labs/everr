import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { ResourceEmptyState } from "#app/components/resource-empty-state.tsx";
import { dashboardListOptions } from "#app/data/dashboards/options.ts";

const ASSISTANT_DASHBOARD_PROMPT =
  "/everr-setup-resources Help me build a good first dashboard based on the telemetry we have in production";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/dashboards/get-started",
)({
  staticData: {
    breadcrumb: () => [
      { label: "Dashboards", link: <Link to="/dashboards" /> },
      { label: "Get started" },
    ],
  },
  head: () => ({ meta: [{ title: "Everr - Get started" }] }),
  component: GetStarted,
});

// The index lands here when no dashboard sits at the top level, which is also
// the case when every one is in a folder. Then the list beside this page has
// dashboards, and "No dashboards yet" would contradict it.
function GetStarted() {
  const { preview } = useSearch({ from: "/_authenticated/_organization/_dashboard" });
  const { data: list } = useQuery(dashboardListOptions(preview));
  const hasDashboards = (list ?? []).some((d) => d.previewStatus !== "removed");
  return (
    <ResourceEmptyState
      title={hasDashboards ? "Pick a dashboard" : "No dashboards yet"}
      description={
        hasDashboards
          ? "Open one from the list, or paste this into your coding assistant to build another. It writes the YAML, applies it, and the dashboard shows up here."
          : "Paste this into your coding assistant. It writes the YAML, applies it, and the dashboard shows up here."
      }
      assistantPrompt={ASSISTANT_DASHBOARD_PROMPT}
      docsHref="https://everr.dev/docs/learn/first-dashboard"
    />
  );
}
