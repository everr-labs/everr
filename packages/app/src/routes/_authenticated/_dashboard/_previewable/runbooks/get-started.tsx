import { createFileRoute } from "@tanstack/react-router";
import { ResourceEmptyState } from "@/components/resource-empty-state";

const ASSISTANT_RUNBOOK_PROMPT =
  "/everr-setup-resources Help me build a good first runbook based on the telemetry we have in production";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/runbooks/get-started",
)({
  staticData: {
    breadcrumb: () => [
      { label: "Runbooks", to: "/runbooks" },
      { label: "Get started" },
    ],
  },
  head: () => ({ meta: [{ title: "Everr - Get started" }] }),
  component: () => (
    <ResourceEmptyState
      title="No runbooks yet"
      description="Paste this into your coding assistant. It writes the YAML, applies it, and the runbook shows up here."
      assistantPrompt={ASSISTANT_RUNBOOK_PROMPT}
      docsHref="https://everr.dev/docs/learn/add-a-runbook"
    />
  ),
});
