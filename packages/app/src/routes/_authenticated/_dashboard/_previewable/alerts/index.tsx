import { Skeleton } from "@everr/ui/components/skeleton";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef } from "react";
import { PageHeader } from "@/components/page-header";
import { alertingQueries } from "@/data/alerting/queries";
import { alertingBudgetExhausted } from "@/data/alerting/slo";
import {
  alertingExhaustedBudgets,
  alertingFiringGroups,
  alertingGroupInstances,
  alertingResolveTriageInstances,
  alertingTriageCounts,
  TRIAGE_EVENT_RANGE,
} from "@/data/alerting/triage";
import type { AlertingSloStatus } from "@/data/alerting/types";
import { AlertingExhaustedBudgetsCard } from "./-components/exhausted-budgets";
import { AlertingPipelineStrip } from "./-components/pipeline-strip";
import { AlertingQueryError } from "./-components/shared";
import {
  SilenceCreateDrawer,
  type SilenceDrawerHandle,
  SilencesPanel,
} from "./-components/silences-panel";
import { TriageBoard } from "./-components/triage-board";
import { useAlertingFreshBudgets } from "./-components/use-fresh-budgets";

// One stored event only: it date-stamps the all-clear readout (quiet board vs
// broken pipeline); nothing on this page lists events.
const TRIAGE_EVENT_LIMIT = 1;

// Stable identity for `?? EMPTY`: a fresh `[]` each render would churn every
// memo keyed on it.
const EMPTY: never[] = [];

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/",
)({
  staticData: { breadcrumb: "Triage" },
  head: () => ({ meta: [{ title: "Everr - Alerting Triage" }] }),
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      queryClient.prefetchQuery(alertingQueries.alerts(deps.preview)),
      queryClient.prefetchQuery(alertingQueries.rules()),
      queryClient.prefetchQuery(alertingQueries.slos(deps.preview)),
      queryClient.prefetchQuery(alertingQueries.routes()),
      queryClient.prefetchQuery(alertingQueries.receivers()),
      queryClient.prefetchQuery(alertingQueries.silences()),
      queryClient.prefetchQuery(
        // Same options the component asks for, preview included, or the
        // prefetch warms a key nothing reads.
        alertingQueries.eventHistory(TRIAGE_EVENT_RANGE, {
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
  const alerts = useQuery(alertingQueries.alerts(preview));
  const rules = useQuery(alertingQueries.rules());
  const slos = useQuery(alertingQueries.slos(preview));
  const routes = useQuery(alertingQueries.routes());
  const receivers = useQuery(alertingQueries.receivers());
  const silences = useQuery(alertingQueries.silences());
  const events = useQuery(
    alertingQueries.eventHistory(TRIAGE_EVENT_RANGE, {
      limit: TRIAGE_EVENT_LIMIT,
      preview,
    }),
  );
  const slosData = slos.data ?? EMPTY;
  const rulesData = rules.data ?? EMPTY;
  // TanStack caches the combined value per combine-function identity; an
  // inline arrow would hand out a fresh Map every render.
  const snapshotStatuses = useQueries({
    queries: slosData.map((s) => alertingQueries.sloStatus(s.id)),
    combine: useCallback(
      (results: { data?: AlertingSloStatus | null }[]) =>
        new Map(
          slosData.map((s, i) => [s.id, results[i]?.data?.payload ?? null]),
        ),
      [slosData],
    ),
  });

  // On a alerting engine outage every count would render 0 — a false "all clear" — so any
  // errored core query fails the whole page.
  const coreQueries = [alerts, rules, slos, routes, receivers, silences];
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
        slos: slosData,
        routes: routes.data ?? EMPTY,
        silences: silences.data ?? EMPTY,
        now: Date.now(),
      }),
    [alerts.data, rulesData, slosData, routes.data, silences.data],
  );
  const groups = useMemo(() => alertingGroupInstances(instances), [instances]);
  // Counts run over the FULL grouping (pending included); the board takes the
  // firing-only cut.
  const counts = useMemo(
    () => alertingTriageCounts(groups, silences.data ?? EMPTY, Date.now()),
    [groups, silences.data],
  );
  const boardGroups = useMemo(() => alertingFiringGroups(groups), [groups]);

  // The engine snapshot's budget lags (~window/12 between re-evaluations), so
  // displayed SLOs get the same read-time scan the SLO pages use. Bounded:
  // triage never scans SLOs it does not show.
  const freshIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of boardGroups) {
      if (g.sloId !== undefined) ids.add(g.sloId);
    }
    for (const slo of slosData) {
      if (slo.paused) continue;
      const snapshot = snapshotStatuses.get(slo.id);
      if (alertingBudgetExhausted(snapshot?.budget_remaining ?? null)) {
        ids.add(slo.id);
      }
    }
    return [...ids];
  }, [boardGroups, slosData, snapshotStatuses]);
  const freshBudgets = useAlertingFreshBudgets(freshIds);
  const sloStatuses = useMemo(
    () =>
      new Map(
        slosData.map((s) => {
          const snapshot = snapshotStatuses.get(s.id);
          return [
            s.id,
            snapshot ? freshBudgets.apply(s, snapshot) : null,
          ] as const;
        }),
      ),
    [slosData, snapshotStatuses, freshBudgets],
  );

  const watchingRules = rulesData.filter((r) => !r.paused).length;
  // Row-derived numbers come from `counts` only, so the strip and the board
  // can never disagree.
  const pipelineFacts = {
    ...counts,
    watchingRules,
    pausedRules: rulesData.filter((r) => r.paused).length,
    watchingSlos: slosData.filter((s) => !s.paused).length,
    routeCount: (routes.data ?? EMPTY).length,
    receiverCount: (receivers.data ?? EMPTY).length,
  };

  const exhausted = useMemo(
    () => alertingExhaustedBudgets(slosData, sloStatuses),
    [slosData, sloStatuses],
  );

  if (errored) return <AlertingQueryError error={errored.error} />;

  const pending = coreQueries.some((query) => query.isPending);
  const lastEventTs = events.data?.[0]?.timestamp ?? null;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Triage"
        lede="Everything firing or muted right now, and the fastest way to act on it: silence it, follow its runbook, check who was told."
        docsHref="https://everr.dev/docs/concepts/how-alerts-work"
      />

      {/* Gated on load — zeros while fetching would read as a false all-clear. */}
      {pending ? (
        <Skeleton className="h-16 w-full rounded-md" />
      ) : (
        <AlertingPipelineStrip facts={pipelineFacts} />
      )}

      <TriageBoard
        groups={boardGroups}
        pending={pending}
        channelsByReceiver={channelsByReceiver}
        sloStatuses={sloStatuses}
        watchingRules={watchingRules}
        lastEventTs={lastEventTs}
        eventsUnavailable={events.isError}
        onCustomSilence={(matchers) =>
          silenceDrawer.current?.openWith(matchers)
        }
      />

      <AlertingExhaustedBudgetsCard items={exhausted} />

      <SilencesPanel onNewSilence={() => silenceDrawer.current?.openWith([])} />
      <SilenceCreateDrawer ref={silenceDrawer} />
    </div>
  );
}
