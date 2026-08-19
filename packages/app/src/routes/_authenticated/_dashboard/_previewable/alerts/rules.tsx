import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/rules",
)({
  staticData: { breadcrumb: "All Rules" },
  head: () => ({ meta: [{ title: "Everr - Alert rules" }] }),
  component: AlertingRulesPage,
});

function AlertingRulesPage() {
  return (
    <div className="space-y-3">
      <PageHeader
        title="All Rules"
        lede="Every rule watching your telemetry, firing or not."
        docsHref="https://everr.dev/docs/concepts/how-alerts-work"
      />
    </div>
  );
}
