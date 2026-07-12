import { withTimeRange } from "@everr/ui/lib/time-range";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  AlertEventFeed,
  type CcRuleFacts,
  ccEventHistoryQueryOptions,
} from "@/components/cc/alert-event-feed";
import { fromCcRuleSpec } from "@/data/alerts/mapping";
import { CC_POLL_INTERVAL_MS, listCcRules } from "@/data/cc/server";

const rulesQuery = () =>
  queryOptions({
    queryKey: ["cc", "rules"],
    queryFn: () => listCcRules(),
    refetchInterval: CC_POLL_INTERVAL_MS,
  });

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
  // otherwise the bare rule id. Resolve either to the rule's facts (name to
  // display, id to link, severity for stored-history gaps, the notification
  // title template to summarize transitions); an unknown handle renders as-is.
  const resolveRule = useMemo(() => {
    const byHandle = new Map<string, CcRuleFacts>();
    for (const rule of rules.data ?? []) {
      const view = fromCcRuleSpec(rule.spec);
      const facts: CcRuleFacts = {
        id: rule.id,
        name: view.displayName || view.slug || rule.id.slice(0, 8),
        severity: rule.spec.severity,
        titleTemplate: view.notificationTitleTemplate || null,
      };
      byHandle.set(rule.id, facts);
      if (view.slug) byHandle.set(view.slug, facts);
    }
    return (handle: string) => byHandle.get(handle);
  }, [rules.data]);

  return <AlertEventFeed resolveRule={resolveRule} />;
}
