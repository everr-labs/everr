import { withTimeRange } from "@everr/ui/lib/time-range";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  AlertEventFeed,
  ccEventHistoryQueryOptions,
} from "@/components/cc/alert-event-feed";
import { fromCcRuleSpec } from "@/data/alerts/mapping";
import { listCcRules } from "@/data/cc/server";

const rulesQuery = () =>
  queryOptions({ queryKey: ["cc", "rules"], queryFn: () => listCcRules() });

export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts/history",
)({
  staticData: {
    breadcrumb: "History",
    // The alerts section hides the global time-range picker; this page reads
    // stored history, so it opts back in (the deepest staticData value wins).
    hideTimeRangePicker: false,
  },
  head: () => ({ meta: [{ title: "Everr - Alerts History" }] }),
  loaderDeps: ({ search }) => ({ timeRange: withTimeRange(search).timeRange }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      queryClient.prefetchQuery(ccEventHistoryQueryOptions(deps.timeRange)),
      queryClient.prefetchQuery(rulesQuery()),
    ]),
  component: CcHistoryPage,
});

function CcHistoryPage() {
  const rules = useQuery(rulesQuery());

  // Event rows carry a rule handle: the slug (everr.name) when CC knows it,
  // otherwise the bare rule id. Resolve both to the rule's display name and
  // (for events whose own severity is a genuine stored-history gap) its
  // severity; an unknown handle renders as-is.
  const { resolveRuleName, resolveRuleSeverity } = useMemo(() => {
    const nameByHandle = new Map<string, string>();
    const severityByHandle = new Map<string, string>();
    for (const rule of rules.data ?? []) {
      const view = fromCcRuleSpec(rule.spec);
      const name = view.displayName || view.slug;
      if (name) {
        nameByHandle.set(rule.id, name);
        if (view.slug) nameByHandle.set(view.slug, name);
      }
      severityByHandle.set(rule.id, rule.spec.severity);
      if (view.slug) severityByHandle.set(view.slug, rule.spec.severity);
    }
    return {
      resolveRuleName: (handle: string) => nameByHandle.get(handle) ?? handle,
      resolveRuleSeverity: (handle: string) => severityByHandle.get(handle),
    };
  }, [rules.data]);

  return (
    <AlertEventFeed
      showTypeLens
      resolveRuleName={resolveRuleName}
      resolveRuleSeverity={resolveRuleSeverity}
    />
  );
}
