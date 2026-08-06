import { buttonVariants } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
} from "@everr/ui/components/collapsible";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { RelativeTime } from "@everr/ui/components/relative-time";
import { Skeleton } from "@everr/ui/components/skeleton";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpenText, CircleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { alertingConditionOperatorLabel } from "@/data/alerting/condition";
import { alertingQueries } from "@/data/alerting/queries";
import { pauseAlertingRule, resumeAlertingRule } from "@/data/alerting/server";
import type {
  AlertingAlert,
  AlertingRuleEvaluationSeries,
  AlertingRuleView,
} from "@/data/alerting/types";
import {
  alertingRuleHandles,
  alertingRuleIdentity,
} from "@/data/alerts/rule-identity";
import { useTimeRange } from "@/hooks/use-time-range";
import { AlertEventFeed } from "./-components/alert-event-feed";
import { alertRuleEvaluationOutcome } from "./-components/alert-rule-chart-data";
import { AlertRuleSignalChart } from "./-components/alert-rule-signal-chart";
import {
  AlertingAlertStatusLabel,
  AlertingBackLink,
  AlertingDefRow,
  AlertingDisclosureTrigger,
  AlertingEmptyState,
  AlertingPauseToggle,
  AlertingQueryError,
  AlertingStatusLabel,
  alertingErrorMessage,
  alertingFormatTs,
  LabelSet,
} from "./-components/shared";

function RuleStateLabel({ rule }: { rule: AlertingRuleView }) {
  if (rule.paused) {
    return (
      <AlertingStatusLabel tone="muted" muted>
        Paused
      </AlertingStatusLabel>
    );
  }
  if (rule.spec.suppressed) {
    return (
      <AlertingStatusLabel tone="muted" muted>
        Suppressed
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

function MobileRuleInstances({ instances }: { instances: AlertingAlert[] }) {
  if (instances.length === 0) {
    return (
      <AlertingEmptyState
        title="No active instances"
        hint="This rule isn't firing or pending for any label set right now."
      />
    );
  }
  return (
    <ul className="divide-y divide-border/60">
      {instances.map((instance) => (
        <li key={instance.key} className="space-y-2 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <AlertingAlertStatusLabel status={instance.status} />
            <span className="font-mono text-sm tabular-nums">
              {instance.value ?? "—"}
            </span>
          </div>
          <LabelSet labels={instance.labels} />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Active since</dt>
            <dd className="text-right">
              {alertingFormatTs(instance.active_since)}
            </dd>
            <dt className="text-muted-foreground">Last seen</dt>
            <dd className="text-right">
              {instance.last_seen ? (
                <RelativeTime timestamp={instance.last_seen} />
              ) : (
                "—"
              )}
              {instance.absent_count > 0 &&
                ` · absent x${instance.absent_count}`}
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  );
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
      alertingQueries.ruleByName(params.project, params.slug, deps.preview),
    );
    await Promise.all([
      queryClient.prefetchQuery(alertingQueries.alerts(deps.preview)),
      queryClient.prefetchQuery(
        alertingQueries.ruleEvaluationSeries(rule.id, deps.timeRange),
      ),
      queryClient.prefetchQuery(
        alertingQueries.eventHistory(deps.timeRange, {
          slugs: alertingRuleHandles(rule),
          preview: deps.preview,
        }),
      ),
    ]);
  },
  component: AlertingRuleDetailPage,
});

// ── Page ──────────────────────────────────────────────────────────────────────

function AlertingRuleDetailPage() {
  const { project, slug } = Route.useParams();
  const { preview } = Route.useSearch();
  const qc = useQueryClient();
  const { timeRange } = useTimeRange();
  const rule = useQuery(alertingQueries.ruleByName(project, slug, preview));
  const alerts = useQuery(alertingQueries.alerts(preview));
  const pendingRuleId = rule.data?.id ?? "00000000-0000-0000-0000-000000000000";
  const evaluationSeries = useQuery({
    ...alertingQueries.ruleEvaluationSeries(pendingRuleId, timeRange),
    enabled: rule.data !== undefined,
  });
  const pendingScope = rule.data
    ? alertingRuleHandles(rule.data)
    : ["__rule-loading__"];
  const eventHistory = useQuery({
    ...alertingQueries.eventHistory(timeRange, {
      slugs: pendingScope,
      preview,
    }),
    enabled: rule.data !== undefined,
  });
  const [sqlOpen, setSqlOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);

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
        queryKey: alertingQueries.ruleByName(project, slug, preview).queryKey,
      });
      // The rules listing shows the paused state too.
      qc.invalidateQueries({ queryKey: alertingQueries.rules().queryKey });
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
  // `a.rule` carries the source id for SLO instances too, so exclude those:
  // this page is rule scope.
  const ruleInstances = (alerts.data ?? []).filter(
    (alert: AlertingAlert) =>
      alert.rule === ruleId &&
      alert.slo === undefined &&
      (alert.status === "firing" || alert.status === "pending"),
  );
  const annotationEntries = Object.entries(r.spec.annotations ?? {});
  const annotationSummary = r.spec.annotations?.summary;
  const annotationDescription =
    r.spec.annotations?.description ??
    r.spec.annotations?.["everr.display.description"];
  const scopeHandles = alertingRuleHandles(r);
  const latestEvaluation = evaluationSeries.data?.points.at(-1);
  const latestObservedEvaluation = evaluationSeries.data
    ? [...evaluationSeries.data.points]
        .reverse()
        .find((point) => point.samples.some((sample) => sample.value !== null))
    : undefined;
  const activeValue = ruleInstances.find(
    (instance) => instance.status === "firing" || instance.status === "pending",
  )?.value;
  const latestValues = (latestObservedEvaluation?.samples ?? []).flatMap(
    (sample) => (sample.value === null ? [] : [sample.value]),
  );
  const currentValue = activeValue ?? latestValues[0] ?? null;
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

  const instCols: Column<AlertingAlert>[] = [
    {
      header: "Status",
      cell: (a) => <AlertingAlertStatusLabel status={a.status} />,
    },
    { header: "Labels", cell: (a) => <LabelSet labels={a.labels} /> },
    {
      header: "Value",
      cell: (a) => <span className="tabular-nums">{a.value ?? "—"}</span>,
    },
    { header: "Active since", cell: (a) => alertingFormatTs(a.active_since) },
    {
      // absent_count is consecutive evaluations without the row — the
      // instance is on its way to resolving.
      header: "Last seen",
      cell: (a) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {a.last_seen ? <RelativeTime timestamp={a.last_seen} /> : "—"}
          {a.absent_count > 0 && ` · absent x${a.absent_count}`}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <AlertingBackLink to="/alerts/rules" label="Back to rules" />
            <h2 className="truncate text-base font-semibold">
              {identity.name}
            </h2>
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
        <dl
          className="flex flex-wrap gap-x-5 gap-y-1 pl-7 text-xs"
          aria-label="Current rule status"
        >
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Instances</dt>
            <dd className="font-mono tabular-nums">
              {ruleInstances.length} active
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">
              {currentValue === null ? "Condition" : "Latest value"}
            </dt>
            <dd className="font-mono tabular-nums">
              {currentValue === null && "value "}
              {currentValue ?? ""} {conditionOperator}{" "}
              {r.spec.condition.threshold}
              {r.spec.for_secs > 0 &&
                ` for ${conciseDuration(r.spec.for_secs)}`}
            </dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">Evaluated</dt>
            <dd>
              {latestEvaluationAt ? (
                <RelativeTime timestamp={latestEvaluationAt} />
              ) : (
                "Never"
              )}
            </dd>
          </div>
        </dl>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            <h3>Signal history</h3>
          </CardTitle>
          <CardDescription>
            Values evaluated by this rule, with its firing threshold and state
            transitions over the selected time range.
          </CardDescription>
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

      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>
            <h3>Current activity</h3>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 px-3 pb-2">
            {(
              [
                ["Last fired", r.rollup.last_fired_at],
                ["Last resolved", r.rollup.last_resolved_at],
                ["Last seen", r.rollup.last_seen_at],
              ] as const
            ).map(([label, ts]) => (
              <div key={label} className="flex items-baseline gap-1.5">
                <dt className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
                  {label}
                </dt>
                <dd
                  className="font-mono text-xs tabular-nums"
                  title={alertingFormatTs(ts)}
                >
                  {ts ? <RelativeTime timestamp={ts} /> : "—"}
                </dd>
              </div>
            ))}
            <div className="flex items-baseline gap-1.5">
              <dt className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
                Last row count
              </dt>
              <dd className="font-mono text-xs tabular-nums">
                {String(r.rollup.last_row_count ?? "—")}
              </dd>
            </div>
          </dl>
          {alerts.isPending ? (
            <div className="px-3 py-2">
              <Skeleton className="h-7 w-full" />
            </div>
          ) : (
            <>
              <div className="md:hidden">
                <MobileRuleInstances instances={ruleInstances} />
              </div>
              <div className="hidden md:block">
                <DataTable
                  data={ruleInstances}
                  columns={instCols}
                  rowKey={(a) => a.key}
                  emptyState={
                    <AlertingEmptyState
                      title="No active instances"
                      hint="This rule isn't firing or pending for any label set right now."
                    />
                  }
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h3>Definition</h3>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(annotationSummary || annotationDescription) && (
            <div className="max-w-[75ch] space-y-1">
              {annotationSummary && (
                <p className="text-sm font-medium">{annotationSummary}</p>
              )}
              {annotationDescription && (
                <p className="text-xs text-muted-foreground">
                  {annotationDescription}
                </p>
              )}
            </div>
          )}
          <dl className="divide-y divide-border/60">
            <AlertingDefRow label="Interval">
              {r.spec.interval_secs}s
            </AlertingDefRow>
            {r.spec.max_interval_secs != null && (
              <AlertingDefRow label="Max interval">
                {r.spec.max_interval_secs}s
              </AlertingDefRow>
            )}
            <AlertingDefRow label="For">{r.spec.for_secs}s</AlertingDefRow>
            <AlertingDefRow label="Resolve after">
              {r.spec.resolve_after} missed evaluation
              {r.spec.resolve_after === 1 ? "" : "s"}
            </AlertingDefRow>
            <AlertingDefRow label="Label columns">
              {r.spec.label_columns.join(", ") || "—"}
            </AlertingDefRow>
            <AlertingDefRow label="Condition">
              <span className="font-mono">
                value {conditionOperator} {r.spec.condition.threshold}
              </span>
            </AlertingDefRow>
            <AlertingDefRow label="Delivery">
              {r.notification_channels.length > 0
                ? `Explicit channels: ${r.notification_channels.join(", ")}`
                : "Advanced routing"}
            </AlertingDefRow>
          </dl>
          {annotationEntries.length > 0 && (
            <Collapsible
              open={annotationsOpen}
              onOpenChange={setAnnotationsOpen}
            >
              <AlertingDisclosureTrigger open={annotationsOpen}>
                <span className="text-xs font-medium">
                  Advanced annotations
                </span>
                {!annotationsOpen && (
                  <span className="min-w-0 truncate text-[0.6875rem] text-muted-foreground">
                    {annotationEntries.length} metadata field
                    {annotationEntries.length === 1 ? "" : "s"}
                  </span>
                )}
              </AlertingDisclosureTrigger>
              <CollapsibleContent>
                <dl className="mt-2 divide-y divide-border/60 rounded-md bg-muted/30 px-3 ring-1 ring-foreground/10">
                  {annotationEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-3"
                    >
                      <dt className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground sm:w-40">
                        {key}
                      </dt>
                      <dd className="min-w-0 break-words text-xs [overflow-wrap:anywhere]">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CollapsibleContent>
            </Collapsible>
          )}
          <Collapsible open={sqlOpen} onOpenChange={setSqlOpen}>
            <AlertingDisclosureTrigger open={sqlOpen}>
              <span className="text-xs font-medium">SQL</span>
              {!sqlOpen && (
                <span className="min-w-0 truncate font-mono text-[0.6875rem] text-muted-foreground">
                  {r.spec.sql}
                </span>
              )}
            </AlertingDisclosureTrigger>
            <CollapsibleContent>
              <pre className="mt-2 overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs ring-1 ring-foreground/10">
                {r.spec.sql}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      <AlertEventFeed preview={preview} scopeSlug={scopeHandles} />
    </div>
  );
}
