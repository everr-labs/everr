import { Skeleton } from "@everr/ui/components/skeleton";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useRef } from "react";
import { ccQueries } from "@/data/cc/queries";
import { ccBudgetExhausted } from "@/data/cc/slo";
import {
  ccExhaustedBudgets,
  ccFiringGroups,
  ccGroupInstances,
  ccResolveTriageInstances,
  ccTriageCounts,
  TRIAGE_EVENT_RANGE,
} from "@/data/cc/triage";
import type { CcSloStatus } from "@/data/cc/types";
import { CcExhaustedBudgetsCard } from "./-components/exhausted-budgets";
import { CcPageIntro } from "./-components/page-intro";
import { CcPipelineStrip } from "./-components/pipeline-strip";
import { CcQueryError } from "./-components/shared";
import {
  SilenceCreateDrawer,
  type SilenceDrawerHandle,
  SilencesPanel,
} from "./-components/silences-panel";
import { TriageBoard } from "./-components/triage-board";
import { useCcFreshBudgets } from "./-components/use-fresh-budgets";

// The board reads one stored event, and only to date-stamp the all-clear
// readout ("last event 4m ago"), which is what separates a quiet board from a
// broken pipeline. Nothing on this page lists events.
const TRIAGE_EVENT_LIMIT = 1;

// One shared empty array, so `?? EMPTY` keeps a stable identity before a query
// resolves; a fresh `[]` each render would churn every memo keyed on it.
const EMPTY: never[] = [];

export const Route = createFileRoute("/_authenticated/_dashboard/alerts/")({
  staticData: { breadcrumb: "Triage" },
  head: () => ({ meta: [{ title: "Everr - Alerting Triage" }] }),
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      queryClient.prefetchQuery(ccQueries.alerts(deps.preview)),
      queryClient.prefetchQuery(ccQueries.rules()),
      queryClient.prefetchQuery(ccQueries.slos(deps.preview)),
      queryClient.prefetchQuery(ccQueries.routes()),
      queryClient.prefetchQuery(ccQueries.receivers()),
      queryClient.prefetchQuery(ccQueries.silences()),
      queryClient.prefetchQuery(ccQueries.subscriptions()),
      queryClient.prefetchQuery(
        // Same options the component asks for, preview included, or the
        // prefetch warms a key nothing reads.
        ccQueries.eventHistory(TRIAGE_EVENT_RANGE, {
          limit: TRIAGE_EVENT_LIMIT,
          preview: deps.preview,
        }),
      ),
    ]),
  component: CcTriagePage,
});

// ── Page ──────────────────────────────────────────────────────────────────────

function CcTriagePage() {
  const { preview } = Route.useSearch();
  const silenceDrawer = useRef<SilenceDrawerHandle>(null);
  const alerts = useQuery(ccQueries.alerts(preview));
  const rules = useQuery(ccQueries.rules());
  const slos = useQuery(ccQueries.slos(preview));
  const routes = useQuery(ccQueries.routes());
  const receivers = useQuery(ccQueries.receivers());
  const silences = useQuery(ccQueries.silences());
  const subscriptions = useQuery(ccQueries.subscriptions());
  const events = useQuery(
    ccQueries.eventHistory(TRIAGE_EVENT_RANGE, {
      limit: TRIAGE_EVENT_LIMIT,
      preview,
    }),
  );
  const slosData = slos.data ?? EMPTY;
  const rulesData = rules.data ?? EMPTY;
  // The combine is memoized because TanStack caches the combined value per
  // combine-function identity: an inline arrow would be a new function every
  // render, handing out a fresh Map each time and re-running the whole
  // derivation chain below for nothing.
  const snapshotStatusGroups = useQueries({
    queries: slosData.map((s) => ccQueries.sloStatus(s.id)),
    combine: useCallback(
      (results: { data?: CcSloStatus | null }[]) =>
        new Map(
          slosData.map((s, i) => [
            s.id,
            results[i]?.data?.payload?.groups ?? [],
          ]),
        ),
      [slosData],
    ),
  });

  // On a CC outage every count would render 0 — a false "all clear" — so any
  // errored core query fails the whole page to the shared error card,
  // matching the sibling pages.
  const coreQueries = [
    alerts,
    rules,
    slos,
    routes,
    receivers,
    silences,
    subscriptions,
  ];
  const errored = coreQueries.find((query) => query.isError);

  const channelsByReceiver = useMemo(
    () => new Map((receivers.data ?? []).map((r) => [r.name, r.channels])),
    [receivers.data],
  );

  // Date.now() is read inside the memos, so a silence window is re-evaluated
  // only when an input changes identity: on a board where nothing is changing,
  // an expired silence can read as silenced until the next `alerts` poll.
  const instances = useMemo(
    () =>
      ccResolveTriageInstances({
        alerts: alerts.data ?? EMPTY,
        rules: rulesData,
        slos: slosData,
        routes: routes.data ?? EMPTY,
        silences: silences.data ?? EMPTY,
        now: Date.now(),
      }),
    [alerts.data, rulesData, slosData, routes.data, silences.data],
  );
  const groups = useMemo(() => ccGroupInstances(instances), [instances]);
  // Counts run over the FULL grouping (pending included); the board takes the
  // firing-only cut, so the strip can still say "2 pending" while triage lists
  // only what is wrong right now.
  const counts = useMemo(
    () => ccTriageCounts(groups, silences.data ?? EMPTY, Date.now()),
    [groups, silences.data],
  );
  const boardGroups = useMemo(() => ccFiringGroups(groups), [groups]);

  // The engine snapshot's budget lags (the budget window re-evaluates only
  // every ~window/12), so the SLOs this page actually displays — firing ones,
  // plus the snapshot-exhausted — get the same read-time budget scan the SLO
  // pages use. A bounded fan-out: triage never scans SLOs it does not show.
  const freshIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of boardGroups) {
      if (g.sloId !== undefined) ids.add(g.sloId);
    }
    for (const slo of slosData) {
      if (slo.paused) continue;
      const snapshot = snapshotStatusGroups.get(slo.id) ?? [];
      if (snapshot.some((g) => ccBudgetExhausted(g.budget_remaining))) {
        ids.add(slo.id);
      }
    }
    return [...ids];
  }, [boardGroups, slosData, snapshotStatusGroups]);
  const freshBudgets = useCcFreshBudgets(freshIds);
  // Snapshot groups with fresh budgets overlaid where the scan has landed;
  // the snapshot stays the instant fallback, exactly as on the SLO pages.
  const sloStatusGroups = useMemo(
    () =>
      new Map(
        slosData.map((s) => [
          s.id,
          freshBudgets.apply(s, snapshotStatusGroups.get(s.id) ?? []),
        ]),
      ),
    [slosData, snapshotStatusGroups, freshBudgets],
  );

  const watchingRules = rulesData.filter((r) => !r.paused).length;
  // Every row-derived number comes from `counts`; nothing is re-filtered here,
  // so the strip and the board can never disagree.
  const pipelineFacts = {
    ...counts,
    watchingRules,
    pausedRules: rulesData.filter((r) => r.paused).length,
    watchingSlos: slosData.filter((s) => !s.paused).length,
    routeCount: (routes.data ?? EMPTY).length,
    receiverCount: (receivers.data ?? EMPTY).length,
  };

  // The standing damage, firing or not: every spent budget, for the card
  // under the board.
  const exhausted = useMemo(
    () => ccExhaustedBudgets(slosData, sloStatusGroups),
    [slosData, sloStatusGroups],
  );

  if (errored) return <CcQueryError error={errored.error} />;

  const pending = coreQueries.some((query) => query.isPending);
  const lastEventTs = events.data?.[0]?.timestamp ?? null;

  return (
    <div className="space-y-3">
      <CcPageIntro
        title="Triage"
        lede="Everything firing or muted right now, and the fastest way to act on it: silence it, follow its runbook, check who was told."
        docsHref="https://everr.dev/docs/concepts/how-alerts-work"
      />

      {/* Gated on load — zeros while fetching would read as a false all-clear. */}
      {pending ? (
        <Skeleton className="h-16 w-full rounded-md" />
      ) : (
        <CcPipelineStrip facts={pipelineFacts} />
      )}

      <TriageBoard
        groups={boardGroups}
        pending={pending}
        channelsByReceiver={channelsByReceiver}
        hasSubscribers={(subscriptions.data ?? []).length > 0}
        sloStatusGroups={sloStatusGroups}
        watchingRules={watchingRules}
        lastEventTs={lastEventTs}
        eventsUnavailable={events.isError}
        onCustomSilence={(matchers) =>
          silenceDrawer.current?.openWith(matchers)
        }
      />

      {/* Spent budgets outlive the fire that spent them, so this is its own
          board rather than a lens on the one above. */}
      <CcExhaustedBudgetsCard items={exhausted} />

      <SilencesPanel onNewSilence={() => silenceDrawer.current?.openWith([])} />
      <SilenceCreateDrawer ref={silenceDrawer} />
    </div>
  );
}
