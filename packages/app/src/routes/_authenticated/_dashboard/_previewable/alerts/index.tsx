import { buttonVariants } from "@everr/ui/components/button";
import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef } from "react";
import { PageHeader } from "@/components/page-header";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import { alertHistoryQueries } from "@/data/alerting/history/queries";
import { alertInstanceQueries } from "@/data/alerting/instances/queries";
import { ruleQueries } from "@/data/alerting/rules/queries";
import { silenceQueries } from "@/data/alerting/silences/queries";
import {
  alertingActiveGroups,
  alertingGroupInstances,
  alertingQuietRules,
  alertingResolveTriageInstances,
  alertingTriageCounts,
  TRIAGE_EVENT_RANGE,
} from "@/data/alerting/triage/summary";
import { AlertingPipelineStrip } from "./-components/delivery/pipeline-strip";
import { AlertingQueryError } from "./-components/shared/components";
import {
  SilenceCreateDrawer,
  type SilenceDrawerHandle,
  SilencesPanel,
} from "./-components/silences/panel";
import { TriageBoard } from "./-components/triage/board";
import { QuietRulesCard } from "./-components/triage/quiet-rules";

// One stored event only: it date-stamps the all-clear readout (quiet board vs
// broken pipeline); nothing on this page lists events.
const TRIAGE_EVENT_LIMIT = 1;

// Stable identity for `?? EMPTY`: a fresh `[]` each render would churn every
// memo keyed on it.
const EMPTY: never[] = [];

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/",
)({
  staticData: { breadcrumb: "Alerts" },
  head: () => ({ meta: [{ title: "Everr - Alerts" }] }),
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      queryClient.prefetchQuery(alertInstanceQueries.list(deps.preview)),
      queryClient.prefetchQuery(ruleQueries.rules(deps.preview)),
      queryClient.prefetchQuery(deliveryQueries.routes()),
      queryClient.prefetchQuery(deliveryQueries.receivers()),
      queryClient.prefetchQuery(silenceQueries.list()),
      queryClient.prefetchQuery(
        // Same options the component asks for, preview included, or the
        // prefetch warms a key nothing reads.
        alertHistoryQueries.events(TRIAGE_EVENT_RANGE, {
          limit: TRIAGE_EVENT_LIMIT,
          preview: deps.preview,
        }),
      ),
    ]),
  component: AlertingTriagePage,
});

// ── Page ──────────────────────────────────────────────────────────────────────

function AlertingTriagePage() {
  const { preview } = Route.useSearch();
  const silenceDrawer = useRef<SilenceDrawerHandle>(null);
  const alerts = useQuery(alertInstanceQueries.list(preview));
  const rules = useQuery(ruleQueries.rules(preview));
  const routes = useQuery(deliveryQueries.routes());
  const receivers = useQuery(deliveryQueries.receivers());
  const silences = useQuery(silenceQueries.list());
  const events = useQuery(
    alertHistoryQueries.events(TRIAGE_EVENT_RANGE, {
      limit: TRIAGE_EVENT_LIMIT,
      preview,
    }),
  );
  const rulesData = rules.data ?? EMPTY;

  // A failed core query must not render as an all-clear zero.
  const coreQueries = [alerts, rules, routes, receivers, silences];
  const errored = coreQueries.find((query) => query.isError);

  const channelsByReceiver = useMemo(
    () => new Map((receivers.data ?? []).map((r) => [r.name, r.channels])),
    [receivers.data],
  );

  // Date.now() is read inside the memos, so an expired silence can read as
  // silenced until the next `alerts` poll changes an input's identity.
  const instances = useMemo(
    () =>
      alertingResolveTriageInstances({
        alerts: alerts.data ?? EMPTY,
        rules: rulesData,
        routes: routes.data ?? EMPTY,
        silences: silences.data ?? EMPTY,
        now: Date.now(),
      }),
    [alerts.data, rulesData, routes.data, silences.data],
  );
  const groups = useMemo(() => alertingGroupInstances(instances), [instances]);
  // Counts run over the FULL grouping (pending included); the board takes the
  // firing-or-pending cut.
  const counts = useMemo(
    () =>
      alertingTriageCounts(
        groups,
        silences.data ?? EMPTY,
        Date.now(),
        channelsByReceiver,
      ),
    [groups, silences.data, channelsByReceiver],
  );
  const boardGroups = useMemo(() => alertingActiveGroups(groups), [groups]);
  const quietRules = useMemo(
    () => alertingQuietRules(rulesData, boardGroups),
    [rulesData, boardGroups],
  );

  const watchingRules = rulesData.filter((r) => !r.paused).length;
  // Row-derived numbers come from `counts` only, so the strip and the board
  // can never disagree.
  const pipelineFacts = {
    ...counts,
    watchingRules,
    pausedRules: rulesData.filter((r) => r.paused).length,
    routeCount: (routes.data ?? EMPTY).length,
    receiverCount: (receivers.data ?? EMPTY).length,
  };

  if (errored) return <AlertingQueryError error={errored.error} />;

  const pending = coreQueries.some((query) => query.isPending);
  const lastEventTs = events.data?.[0]?.timestamp ?? null;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Alerts"
        lede="What is firing now, and every rule watching your telemetry."
        docsHref="https://everr.dev/docs/concepts/how-alerts-work"
        actions={
          <Link
            to="/alerts/delivery"
            className={cn(buttonVariants({ variant: "outline" }), "min-h-8")}
          >
            Delivery
          </Link>
        }
      />

      {/* Wait for the data. Zeros during loading would show a false all-clear. */}
      {pending ? (
        <Skeleton className="h-16 w-full rounded-md" />
      ) : (
        <AlertingPipelineStrip facts={pipelineFacts} />
      )}

      <TriageBoard
        groups={boardGroups}
        pending={pending}
        channelsByReceiver={channelsByReceiver}
        watchingRules={watchingRules}
        lastEventTs={lastEventTs}
        eventsUnavailable={events.isError}
        onCustomSilence={(matchers, options) =>
          silenceDrawer.current?.openWith(matchers, options)
        }
      />

      <QuietRulesCard
        rules={quietRules}
        totalRules={rulesData.length}
        pending={pending}
      />

      <SilencesPanel onNewSilence={() => silenceDrawer.current?.openWith([])} />
      <SilenceCreateDrawer ref={silenceDrawer} />
    </div>
  );
}
