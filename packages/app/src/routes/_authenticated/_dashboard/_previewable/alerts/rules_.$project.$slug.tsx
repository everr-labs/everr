import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { formatResourceName } from "@/data/as-code/identity";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/rules_/$project/$slug",
)({
  staticData: { breadcrumb: "Rule" },
  component: AlertingRuleDetailPage,
});

function AlertingRuleDetailPage() {
  const { project, slug } = Route.useParams();
  return (
    <div className="space-y-3">
      <PageHeader title={formatResourceName(project, slug)} />
    </div>
  );
}
