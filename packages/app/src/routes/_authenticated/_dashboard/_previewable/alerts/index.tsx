import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/",
)({
  staticData: { breadcrumb: "Triage" },
  head: () => ({ meta: [{ title: "Everr - Triage" }] }),
  component: AlertingTriagePage,
});

function AlertingTriagePage() {
  return (
    <div className="space-y-3">
      <PageHeader
        title="Triage"
        lede="What is firing right now, and what it means."
        docsHref="https://everr.dev/docs/concepts/how-alerts-work"
      />
    </div>
  );
}
