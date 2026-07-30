import { Skeleton } from "@everr/ui/components/skeleton";
import { useQueries, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { CcPageIntro } from "@/components/cc/page-intro";
import { CcPipelineStrip } from "@/components/cc/pipeline-strip";
import { CcRecentEventsCard } from "@/components/cc/recent-events";
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
  ccVisibleInstances,
  TRIAGE_EVENT_RANGE,
  type TriageLensKey,
} from "@/data/cc/triage";

// The feed shows this many; the board also reads [0] off it for the all-clear
// freshness line, so one query serves both.
const TRIAGE_EVENT_LIMIT = 8;

// One shared empty array, so `?? EMPTY` keeps a stable identity before a query
// resolves; a fresh `[]` each render would churn every memo keyed on it.
const EMPTY: never[] = [];

export const Route = createFileRoute("/_authenticated/_dashboard/alerts/")({
  staticData: { breadcrumb: "Triage" },
  head: () => ({ meta: [{ title: "Everr - Alerts Triage" }] }),
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
        ccQueries.eventHistory(TRIAGE_EVENT_RANGE, {
          limit: TRIAGE_EVENT_LIMIT,
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

  const [lens, setLens] = useState<TriageLensKey>("firing");

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
  const counts = useMemo(
    () => ccTriageCounts(instances, silences.data ?? EMPTY, Date.now()),
    [instances, silences.data],
  );
  const visible = useMemo(
    () => ccVisibleInstances(instances, lens),
    [instances, lens],
  );
  const groups = useMemo(() => ccGroupInstances(visible), [visible]);

  const watchingRules = rulesData.filter((r) => !r.paused).length;
  // Every instance-derived number comes from `counts`; nothing is re-filtered
  // here, so the strip and the board can never disagree.
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
        lens={lens}
        onLensChange={setLens}
        pending={pending}
        channelsByReceiver={channelsByReceiver}
        hasSubscribers={(subscriptions.data ?? []).length > 0}
        watchingRules={watchingRules}
        lastEventTs={lastEventTs}
        onCustomSilence={(matchers) =>
          silenceDrawer.current?.openWith(matchers)
        }
      />

      <div className="grid items-start gap-3 lg:grid-cols-5">
        {/* Error budget posture, worst group per SLO. */}
        <div className="lg:col-span-3">
          <CcSloPostureCard posture={sloPosture} pending={slos.isPending} />
        </div>
        <div className="lg:col-span-2">
          <CcRecentEventsCard
            events={events}
            slos={slosData}
            rules={rulesData}
          />
        </div>
      </div>

      {/* Muting lives where muting happens: the silences inventory sits under
          the board, and the create drawer is shared with the row actions. */}
      <SilencesPanel onNewSilence={() => silenceDrawer.current?.openWith([])} />
      <SilenceCreateDrawer ref={silenceDrawer} />
    </div>
  );
}
