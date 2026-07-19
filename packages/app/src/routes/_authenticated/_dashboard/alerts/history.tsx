import { withTimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { AlertEventFeed } from "@/components/cc/alert-event-feed";
import { CcPageIntro } from "@/components/cc/page-intro";
import { ccRuleHandleResolvers } from "@/data/alerts/rule-identity";
import { ccQueries } from "@/data/cc/queries";
import { ccSloHandleResolver } from "@/data/cc/slo";

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
      queryClient.prefetchQuery(ccQueries.slos()),
    ]),
  component: CcHistoryPage,
});

function CcHistoryPage() {
  const rules = useQuery(ccQueries.rules());
  const slos = useQuery(ccQueries.slos());

  // Event rows carry a source handle: the slug (everr.name) when CC knows it,
  // otherwise the bare source uuid — for rule- and SLO-originated events
  // alike. The shared resolvers map either handle to the rule's display name
  // and (for records stored before CC stamped severity) its severity, or to
  // the owning SLO; an unknown handle renders as-is.
  const { resolveRuleName, resolveRuleSeverity, resolveRuleId } = useMemo(
    () => ccRuleHandleResolvers(rules.data ?? []),
    [rules.data],
  );
  const resolveSlo = useMemo(
    () => ccSloHandleResolver(slos.data ?? []),
    [slos.data],
  );

  return (
    <div className="space-y-3">
      <CcPageIntro
        title="History"
        lede="The stored record of everything alerting did: fired, resolved, delivered, silenced — over the selected time range."
        explainerLabel="How the event log works"
        explainer={
          <>
            <p>
              Every state change is written to ClickHouse as an event:{" "}
              <strong>transitions</strong> (an instance fired or resolved),{" "}
              <strong>deliveries</strong> (a notification went to a receiver),
              and <strong>silence audits</strong> (a delivery was muted by a
              silence). Rule-health events record when a rule&rsquo;s own
              evaluation degrades.
            </p>
            <p>
              Use it to answer &ldquo;did anyone get told?&rdquo; — a firing
              transition with no delivery event next to it means the alert
              matched no route or was silenced, both worth knowing.
            </p>
          </>
        }
      />
      <AlertEventFeed
        showTypeLens
        resolveRuleName={resolveRuleName}
        resolveRuleSeverity={resolveRuleSeverity}
        resolveSlo={resolveSlo}
        resolveRuleId={resolveRuleId}
      />
    </div>
  );
}
