import { withTimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { AlertEventFeed } from "@/components/cc/alert-event-feed";
import { ccRuleHandleResolvers } from "@/data/alerts/rule-identity";
import { ccQueries } from "@/data/cc/queries";

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
      queryClient.prefetchQuery(ccQueries.eventHistory(deps.timeRange)),
      queryClient.prefetchQuery(ccQueries.rules()),
    ]),
  component: CcHistoryPage,
});

function CcHistoryPage() {
  const rules = useQuery(ccQueries.rules());

  // Event rows carry a rule handle: the slug (everr.name) when CC knows it,
  // otherwise the bare rule id. The shared resolvers map either to the rule's
  // display name and (for records stored before CC stamped severity) its
  // severity; an unknown handle renders as-is.
  const { resolveRuleName, resolveRuleSeverity } = useMemo(
    () => ccRuleHandleResolvers(rules.data ?? []),
    [rules.data],
  );

  return (
    <AlertEventFeed
      showTypeLens
      resolveRuleName={resolveRuleName}
      resolveRuleSeverity={resolveRuleSeverity}
    />
  );
}
