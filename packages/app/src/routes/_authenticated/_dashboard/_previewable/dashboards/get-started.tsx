import { createFileRoute } from "@tanstack/react-router";
import { ResourceEmptyState } from "@/components/resource-empty-state";

const ASSISTANT_DASHBOARD_PROMPT =
  "/everr-setup-resources Help me build a good first dashboard based on the telemetry we have in production";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/dashboards/get-started",
)({
  staticData: {
    breadcrumb: () => [
      { label: "Dashboards", to: "/dashboards" },
      { label: "Get started" },
    ],
  },
  head: () => ({ meta: [{ title: "Everr - Get started" }] }),
  component: () => (
    <ResourceEmptyState
      title="No dashboards yet"
      description="Paste this into your coding assistant. It writes the YAML, applies it, and the dashboard shows up here."
      assistantPrompt={ASSISTANT_DASHBOARD_PROMPT}
      docsHref="https://everr.dev/docs/learn/first-dashboard"
    />
  ),
});
