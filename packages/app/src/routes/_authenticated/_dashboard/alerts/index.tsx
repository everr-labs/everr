import { Skeleton } from "@everr/ui/components/skeleton";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef } from "react";
import { CcPageIntro } from "@/components/cc/page-intro";
import { CcPipelineStrip } from "@/components/cc/pipeline-strip";
import { CcQueryError } from "@/components/cc/shared";
import {
  SilenceCreateDrawer,
  type SilenceDrawerHandle,
  SilencesPanel,
} from "@/components/cc/silences-panel";
import { CcSloPostureCard, firingTiersOf } from "@/components/cc/slo-posture";
import { TriageBoard } from "@/components/cc/triage-board";
import { ccQueries } from "@/data/cc/queries";
import { CC_CANONICAL_SLO_TIERS, ccWorstSloGroup } from "@/data/cc/slo";
import {
  ccGroupInstances,
  ccResolveTriageInstances,
  ccTriageCounts,
  TRIAGE_EVENT_RANGE,
} from "@/data/cc/triage";

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
          ...(deps.preview ? { preview: deps.preview } : {}),
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
      ...(preview ? { preview } : {}),
    }),
  );
  const slosData = slos.data ?? EMPTY;
  const rulesData = rules.data ?? EMPTY;
  const sloStatuses = useQueries({
    queries: slosData.map((s) => ccQueries.sloStatus(s.id)),
  });

  // On a CC outage every count would render 0 — actively misleading (a false
  // "all clear"). Any errored core query fails the whole page to the shared
  // "alerting service unavailable" card, matching the sibling pages.
  const errored = [
    alerts,
    rules,
    slos,
    routes,
    receivers,
    silences,
    subscriptions,
  ].find((query) => query.isError);

  const channelsByReceiver = useMemo(
    () => new Map((receivers.data ?? []).map((r) => [r.name, r.channels])),
    [receivers.data],
  );

  // Date.now() is read inside the memos, so a silence window is re-evaluated
  // whenever they recompute. Only `alerts` polls of these inputs (silences is a
  // config resource, refreshed by mutation invalidation), so on a board where
  // nothing is changing an expired silence can read as silenced until the next
  // input actually changes identity.
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
  // Counted off the grouped rows, not the raw instances, so the strip tallies
  // exactly what the board draws.
  const counts = useMemo(
    () => ccTriageCounts(groups, silences.data ?? EMPTY, Date.now()),
    [groups, silences.data],
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

  const sloPosture = slosData.map((slo, i) => {
    const status = sloStatuses[i];
    const statusGroups = status.data?.payload?.groups ?? [];
    return {
      slo,
      statusPending: status.isPending,
      worst: ccWorstSloGroup(statusGroups),
      firing: firingTiersOf(CC_CANONICAL_SLO_TIERS, statusGroups),
    };
  });

  if (errored) return <CcQueryError error={errored.error} />;

  const pending =
    alerts.isPending ||
    rules.isPending ||
    slos.isPending ||
    routes.isPending ||
    receivers.isPending ||
    silences.isPending ||
    subscriptions.isPending;

  const lastEventTs = events.data?.[0]?.timestamp ?? null;

  return (
    <div className="space-y-3">
      <CcPageIntro
        title="Triage"
        lede="Everything firing or muted right now, and the fastest way to act on it: silence it, follow its runbook, check who was told."
        docsHref="https://everr.dev/docs/concepts/how-alerts-work"
      />

      {/* The pipeline: four live stages. Gated on load — zeros while fetching
          would read as a false all-clear. */}
      {pending ? (
        <Skeleton className="h-16 w-full rounded-md" />
      ) : (
        <CcPipelineStrip facts={pipelineFacts} />
      )}

      <TriageBoard
        groups={groups}
        pending={pending}
        channelsByReceiver={channelsByReceiver}
        hasSubscribers={(subscriptions.data ?? []).length > 0}
        watchingRules={watchingRules}
        lastEventTs={lastEventTs}
        eventsUnavailable={events.isError}
        onCustomSilence={(matchers) =>
          silenceDrawer.current?.openWith(matchers)
        }
      />

      {/* Error budget posture, worst group per SLO. */}
      <CcSloPostureCard posture={sloPosture} pending={slos.isPending} />

      {/* Muting lives where muting happens: the silences inventory sits under
          the board, and the create drawer is shared with the row actions. */}
      <SilencesPanel onNewSilence={() => silenceDrawer.current?.openWith([])} />
      <SilenceCreateDrawer ref={silenceDrawer} />
    </div>
  );
}
