import { Button, buttonVariants } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { RelativeTime } from "@everr/ui/components/relative-time";
import { Skeleton } from "@everr/ui/components/skeleton";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BellOff, BookOpenText, CircleAlert } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PreviewStatusBadge } from "@/components/preview-status-badge";
import { alertHistoryQueries } from "@/data/alerting/history/queries";
import { alertInstanceQueries } from "@/data/alerting/instances/queries";
import { alertingConditionOperatorLabel } from "@/data/alerting/rules/condition";
import {
  alertingRuleHandles,
  alertingRuleIdentity,
} from "@/data/alerting/rules/identity";
import { ruleQueries } from "@/data/alerting/rules/queries";
import {
  pauseAlertingRule,
  resumeAlertingRule,
} from "@/data/alerting/rules/server";
import type {
  AlertingAlert,
  AlertingRuleEvaluationSeries,
  AlertingRuleView,
} from "@/data/alerting/types";
import { useTimeRange } from "@/hooks/use-time-range";
import {
  alertRuleChartPointTarget,
  alertRuleEvaluationOutcome,
  summarizeAlertRuleLatestCheck,
} from "./-components/rules/chart-data";
import {
  RuleMetaLine,
  RuleReferenceDisclosures,
} from "./-components/rules/definition";
import { EvaluationCountdown } from "./-components/rules/evaluation-countdown";
import { AlertRuleHistory } from "./-components/rules/history";
import { AlertRuleSignalChart } from "./-components/rules/signal-chart";
import {
  AlertingBackLink,
  AlertingPauseToggle,
  AlertingQueryError,
  alertingErrorMessage,
} from "./-components/shared/components";
import { AlertingStatusLabel } from "./-components/shared/status";
import {
  AlertingBreachBreakdown,
  AlertingSummaryCard,
  AlertingSummaryStat,
} from "./-components/shared/summary-card";
import {
  SilenceCreateDrawer,
  type SilenceDrawerHandle,
} from "./-components/silences/panel";

function RuleStateLabel({ rule }: { rule: AlertingRuleView }) {
  if (rule.paused) {
    return (
      <AlertingStatusLabel tone="muted" muted>
        Paused
      </AlertingStatusLabel>
    );
  }
  if (rule.health.status === "degraded") {
    return <AlertingStatusLabel tone="danger">Degraded</AlertingStatusLabel>;
  }
  if (rule.rollup.alert_state === "firing") {
    return (
      <AlertingStatusLabel tone="danger" pulse>
        Firing
      </AlertingStatusLabel>
    );
  }
  if (rule.rollup.alert_state === "pending") {
    return (
      <AlertingStatusLabel tone="warning" muted>
        Pending
      </AlertingStatusLabel>
    );
  }
  return (
    <AlertingStatusLabel tone="healthy" muted>
      OK
    </AlertingStatusLabel>
  );
}

function useAlertRuleChartMeasurement() {
  const ref = useRef<HTMLDivElement>(null);
  const widthRef = useRef(0);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let measured = false;
    const update = (width: number) => {
      if (width <= 0) return;
      widthRef.current = width;
      if (!measured) {
        measured = true;
        setReady(true);
      }
    };
    update(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const getPoints = useCallback(
    () => alertRuleChartPointTarget(widthRef.current),
    [],
  );
  return { ref, ready, getPoints };
}

function conciseDuration(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.ceil(seconds))}s`;
  if (seconds < 3_600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.ceil(seconds / 3_600)}h`;
}

function AlertRuleDiagnosis({
  rule,
  instances,
  evaluationSeries,
}: {
  rule: AlertingRuleView;
  instances: readonly AlertingAlert[];
  evaluationSeries: AlertingRuleEvaluationSeries;
}) {
  const recent = evaluationSeries.recent_points;
  const latest = recent.at(-1);
  const latestOutcome = latest
    ? alertRuleEvaluationOutcome(latest, rule.spec.condition)
    : null;
  let title: string | null = null;
  let description: string | null = null;

  if (rule.health.status === "degraded" || latestOutcome === "failed") {
    title = "Evaluation is failing";
    const failures = Math.max(1, rule.health.consecutive_failures);
    description = `${failures} consecutive ${failures === 1 ? "failure" : "failures"}. ${latest?.error ?? rule.health.last_error ?? "Check the rule query and its data source."}`;
  } else if (
    latestOutcome === "no_data" ||
    (latestOutcome === "unknown" && rule.rollup.last_row_count === 0)
  ) {
    let consecutive = 0;
    for (let index = recent.length - 1; index >= 0; index -= 1) {
      if (
        alertRuleEvaluationOutcome(recent[index], rule.spec.condition) !==
        "no_data"
      ) {
        break;
      }
      consecutive += 1;
    }
    title = "No data returned";
    description =
      consecutive > 0
        ? `${consecutive} consecutive ${consecutive === 1 ? "evaluation produced" : "evaluations produced"} no numeric values. Empty results cannot fire the rule and count toward resolving existing instances.`
        : "The latest evaluation returned 0 rows. Empty results cannot fire the rule and count toward resolving existing instances.";
  } else {
    const pending = instances.filter(
      (instance) => instance.status === "pending",
    );
    if (pending.length > 0 && rule.spec.for_secs > 0) {
      const oldestPendingAt = pending.reduce<number | null>((oldest, item) => {
        if (!item.pending_since) return oldest;
        const timestamp = Date.parse(item.pending_since);
        return oldest === null ? timestamp : Math.min(oldest, timestamp);
      }, null);
      const observedAt = latest
        ? Date.parse(latest.t)
        : Date.parse(rule.rollup.last_seen_at ?? "");
      const elapsed =
        oldestPendingAt && Number.isFinite(observedAt)
          ? Math.max(0, (observedAt - oldestPendingAt) / 1_000)
          : 0;
      const remaining = Math.max(0, rule.spec.for_secs - elapsed);
      title = "Threshold breached, waiting to fire";
      description = `${pending.length} ${pending.length === 1 ? "instance has" : "instances have"} breached the condition. The rule requires ${conciseDuration(rule.spec.for_secs)} continuously${oldestPendingAt ? `, about ${conciseDuration(remaining)} remaining` : ""}.`;
    }
  }

  if (!title || !description || rule.paused) return null;
  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-md bg-amber-500/5 px-3 py-2.5 text-xs ring-1 ring-amber-500/20">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">{title}</p>
        <p className="max-w-[75ch] break-words text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/rules_/$project/$slug",
)({
  staticData: {
    breadcrumb: "Rule",
    // The alerts section hides the global time-range picker; the scoped
    // event timeline below reads stored history, so this page opts back in.
    hideTimeRangePicker: false,
  },
  loaderDeps: ({ search }) => ({
    timeRange: withTimeRange(search).timeRange,
    preview: search.preview,
  }),
  loader: async ({ context: { queryClient }, params, deps }) => {
    // Rule first: the event-timeline prefetch is scoped to its handles.
    const rule = await queryClient.ensureQueryData(
      ruleQueries.ruleByName(params.project, params.slug, deps.preview),
    );
    await Promise.all([
      queryClient.prefetchQuery(alertInstanceQueries.list(deps.preview)),
      queryClient.prefetchQuery(
        alertHistoryQueries.events(deps.timeRange, {
          slugs: alertingRuleHandles(rule),
          repoid: rule.repoid,
          preview: deps.preview,
        }),
      ),
    ]);
    return { timeDefaults: { refresh: "10s" } };
  },
  component: AlertingRuleDetailPage,
});

// ── Page ──────────────────────────────────────────────────────────────────────

function AlertingRuleDetailPage() {
  const { project, slug } = Route.useParams();
  const { preview } = Route.useSearch();
  const qc = useQueryClient();
  const { timeRange } = useTimeRange();
  const silenceDrawer = useRef<SilenceDrawerHandle>(null);
  const signalChart = useAlertRuleChartMeasurement();
  const rule = useQuery({
    ...ruleQueries.ruleByName(project, slug, preview),
    refetchInterval: false,
  });
  const alerts = useQuery({
    ...alertInstanceQueries.list(preview),
    refetchInterval: false,
  });
  const pendingRuleId = rule.data?.id ?? "00000000-0000-0000-0000-000000000000";
  const evaluationSeries = useQuery({
    ...ruleQueries.evaluationSeries(
      pendingRuleId,
      timeRange,
      signalChart.getPoints,
    ),
    enabled: rule.data !== undefined && signalChart.ready,
    refetchInterval: false,
  });
  const pendingScope = rule.data
    ? alertingRuleHandles(rule.data)
    : ["__rule-loading__"];
  const eventHistory = useQuery({
    ...alertHistoryQueries.events(timeRange, {
      slugs: pendingScope,
      ...(rule.data ? { repoid: rule.data.repoid } : {}),
      preview,
    }),
    enabled: rule.data !== undefined,
    refetchInterval: false,
  });
  const toggle = useMutation({
    mutationFn: (paused: boolean) => {
      const ruleId = rule.data?.id;
      if (!ruleId) throw new Error("Rule not loaded");
      return paused
        ? resumeAlertingRule({ data: { ruleId } })
        : pauseAlertingRule({ data: { ruleId } });
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ruleQueries.ruleByName(project, slug, preview).queryKey,
      });
      // The rules listing shows the paused state too.
      qc.invalidateQueries({ queryKey: ruleQueries.rulesFamily });
      toast.success("Rule updated");
    },
    onError: (e) => toast.error(alertingErrorMessage(e)),
  });

  if (rule.isError) return <AlertingQueryError error={rule.error} />;

  if (!rule.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const r = rule.data;
  const ruleId = r.id;
  const identity = alertingRuleIdentity(r);
  const ruleInstances = (alerts.data ?? []).filter(
    (alert: AlertingAlert) =>
      alert.rule === ruleId &&
      (alert.status === "firing" || alert.status === "pending"),
  );
  const annotationSummary = r.spec.annotations?.summary;
  const annotationDescription =
    r.spec.annotations?.description ??
    r.spec.annotations?.["everr.display.description"];
  const latestEvaluation = evaluationSeries.data?.points.at(-1);
  const latestCheck = latestEvaluation
    ? summarizeAlertRuleLatestCheck(latestEvaluation, r.spec.condition)
    : null;
  const latestEvaluationAt =
    latestEvaluation?.t ?? r.rollup.last_seen_at ?? null;
  const conditionOperator = alertingConditionOperatorLabel(
    r.spec.condition.operator,
  );
  const currentFiringFingerprints = ruleInstances.flatMap((instance) => {
    if (instance.status !== "firing") return [];
    const prefix = `${ruleId}:`;
    return [
      instance.key.startsWith(prefix)
        ? instance.key.slice(prefix.length)
        : instance.key,
    ];
  });
  const firingInstanceCount = ruleInstances.filter(
    (instance) => instance.status === "firing",
  ).length;
  const pendingInstanceCount = ruleInstances.length - firingInstanceCount;
  const lastFiredAt = r.rollup.last_fired_at;
  const lastResolvedAt = r.rollup.last_resolved_at;
  const lastTransition =
    lastFiredAt &&
    (!lastResolvedAt || Date.parse(lastFiredAt) >= Date.parse(lastResolvedAt))
      ? { label: "Fired", timestamp: lastFiredAt }
      : lastResolvedAt
        ? { label: "Resolved", timestamp: lastResolvedAt }
        : null;

  return (
    <div className="space-y-3">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <AlertingBackLink to="/alerts/rules" label="All Rules" />
            <h2 className="truncate text-base font-semibold">
              {identity.name}
            </h2>
            <PreviewStatusBadge status={r.previewStatus} />
            <RuleStateLabel rule={r} />
          </div>
          <div className="flex items-center gap-2">
            {identity.runbook && (
              <Link
                to="/runbooks/$project/$slug"
                params={identity.runbook}
                className={cn(buttonVariants({ variant: "ghost" }))}
              >
                <BookOpenText data-icon="inline-start" />
                Runbook
              </Link>
            )}
            {r.previewId === null && (
              <Button
                variant="outline"
                onClick={() =>
                  silenceDrawer.current?.openWith(
                    [{ label: "rule", op: "eq", value: ruleId }],
                    {
                      lockSeed: true,
                      seedValueLabels: [identity.name],
                    },
                  )
                }
              >
                <BellOff data-icon="inline-start" />
                Silence
              </Button>
            )}
            <AlertingPauseToggle
              paused={r.paused}
              pending={toggle.isPending}
              kind="alert rule"
              name={alertingRuleIdentity(r).name}
              variant="outline"
              onToggle={() => toggle.mutate(r.paused)}
            />
          </div>
        </div>
        {annotationSummary && (
          <p className="text-sm text-muted-foreground">{annotationSummary}</p>
        )}
        {annotationDescription &&
          annotationDescription !== annotationSummary && (
            <p className="text-sm text-muted-foreground">
              {annotationDescription}
            </p>
          )}
        <RuleMetaLine rule={r} />
        <AlertingSummaryCard ariaLabel="Rule activity summary">
          <AlertingSummaryStat
            label="Breaching instances"
            value={
              alerts.isPending ? (
                <Skeleton className="h-6 w-10" />
              ) : (
                ruleInstances.length
              )
            }
            detail={
              alerts.isPending ? (
                <Skeleton className="h-3 w-24" />
              ) : (
                <AlertingBreachBreakdown
                  firing={firingInstanceCount}
                  pending={pendingInstanceCount}
                />
              )
            }
          />
          <AlertingSummaryStat
            label="Latest check"
            value={
              evaluationSeries.isPending ? (
                <Skeleton className="h-6 w-16" />
              ) : evaluationSeries.isError ? (
                <span className="text-destructive">Unavailable</span>
              ) : latestEvaluation?.failed ? (
                <span className="text-destructive">Failed</span>
              ) : latestCheck ? (
                `${latestCheck.total} series`
              ) : (
                "Never"
              )
            }
            detail={
              evaluationSeries.isPending ? (
                <Skeleton className="h-3 w-28" />
              ) : evaluationSeries.isError ? (
                <span className="text-destructive">Check could not load</span>
              ) : latestEvaluation?.failed ? (
                <span className="text-destructive">Evaluation failed</span>
              ) : latestCheck && latestCheck.total > 0 ? (
                <span className="inline-flex items-center gap-2.5">
                  <span>
                    <span className="font-medium text-destructive tabular-nums">
                      {latestCheck.breached}
                    </span>{" "}
                    breaching
                  </span>
                  <span>
                    <span className="font-medium text-emerald-600 tabular-nums dark:text-emerald-400">
                      {latestCheck.healthy}
                    </span>{" "}
                    healthy
                  </span>
                  {latestCheck.noData > 0 && (
                    <span>
                      <span className="font-medium tabular-nums">
                        {latestCheck.noData}
                      </span>{" "}
                      no data
                    </span>
                  )}
                </span>
              ) : latestCheck ? (
                "No series returned"
              ) : null
            }
          />
          <AlertingSummaryStat
            label="Evaluated"
            value={
              latestEvaluationAt ? (
                <RelativeTime timestamp={latestEvaluationAt} />
              ) : (
                "Never"
              )
            }
            detail={
              <EvaluationCountdown
                nextEvaluationAt={r.rollup.next_evaluation_at}
                paused={r.paused}
              />
            }
          />
          <AlertingSummaryStat
            label="Last transition"
            value={
              lastTransition ? (
                <>
                  {lastTransition.label}{" "}
                  <RelativeTime timestamp={lastTransition.timestamp} />
                </>
              ) : (
                "None"
              )
            }
          />
        </AlertingSummaryCard>
      </header>

      <Card ref={signalChart.ref} className="pb-0">
        <CardHeader>
          <CardTitle>
            <h3>Signal history</h3>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            value {conditionOperator} {r.spec.condition.threshold}
            {r.spec.label_columns.length > 0 &&
              ` · grouped by ${r.spec.label_columns.join(", ")}`}
          </p>
        </CardHeader>
        <CardContent>
          {evaluationSeries.data && (
            <AlertRuleDiagnosis
              rule={r}
              instances={ruleInstances}
              evaluationSeries={evaluationSeries.data}
            />
          )}
          {evaluationSeries.isError ? (
            <div className="flex h-72 items-center justify-center text-sm text-destructive">
              Signal history unavailable (
              {alertingErrorMessage(evaluationSeries.error)}).
            </div>
          ) : evaluationSeries.isPending ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <AlertRuleSignalChart
              evaluationSeries={evaluationSeries.data}
              events={eventHistory.data ?? []}
              condition={r.spec.condition}
              timeRange={timeRange}
              intervalSeconds={r.spec.interval_secs}
              currentFiringFingerprints={currentFiringFingerprints}
            />
          )}
        </CardContent>
      </Card>

      <AlertRuleHistory
        evaluationSeries={evaluationSeries.data}
        evaluationPending={evaluationSeries.isPending}
        evaluationError={
          evaluationSeries.isError ? evaluationSeries.error : null
        }
        condition={r.spec.condition}
        events={eventHistory.data ?? []}
        eventsPending={eventHistory.isPending}
        eventsError={eventHistory.isError ? eventHistory.error : null}
      />

      <RuleReferenceDisclosures rule={r} />
      <SilenceCreateDrawer ref={silenceDrawer} />
    </div>
  );
}
