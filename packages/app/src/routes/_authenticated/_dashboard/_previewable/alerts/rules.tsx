import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { alertInstanceQueries } from "@/data/alerting/instances/queries";
import { ruleQueries } from "@/data/alerting/rules/queries";
import { AlertingQueryError } from "./-components/shared/components";
import { AlertingRulesCard } from "./-components/triage/quiet-rules";

// Stable identity for `?? EMPTY`: a fresh `[]` each render would churn every
// memo keyed on it.
const EMPTY: never[] = [];

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/rules",
)({
  staticData: { breadcrumb: "All Rules" },
  head: () => ({ meta: [{ title: "Everr - Alert rules" }] }),
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      queryClient.prefetchQuery(ruleQueries.rules(deps.preview)),
      queryClient.prefetchQuery(alertInstanceQueries.list(deps.preview)),
    ]),
  component: AlertingRulesPage,
});

function AlertingRulesPage() {
  const { preview } = Route.useSearch();
  const rules = useQuery(ruleQueries.rules(preview));
  const alerts = useQuery(alertInstanceQueries.list(preview));

  if (rules.isError) return <AlertingQueryError error={rules.error} />;

  // Kept apart, not merged into one "active" set: Triage labels these two
  // states differently (`FIRING SINCE` vs `PENDING SINCE`), so a rule with
  // only a pending instance would read as firing here otherwise, disagreeing
  // with the page the reader just came from.
  const firingRuleIds = new Set(
    (alerts.data ?? EMPTY)
      .filter((a) => a.status === "firing")
      .map((a) => a.rule),
  );
  const pendingRuleIds = new Set(
    (alerts.data ?? EMPTY)
      .filter((a) => a.status === "pending")
      .map((a) => a.rule),
  );

  return (
    <div className="space-y-3">
      <PageHeader
        title="All Rules"
        lede="Every rule watching your telemetry, firing or not."
        docsHref="https://everr.dev/docs/concepts/how-alerts-work"
      />
      <AlertingRulesCard
        rules={rules.data ?? EMPTY}
        firingRuleIds={firingRuleIds}
        pendingRuleIds={pendingRuleIds}
        pending={rules.isPending}
      />
    </div>
  );
}
