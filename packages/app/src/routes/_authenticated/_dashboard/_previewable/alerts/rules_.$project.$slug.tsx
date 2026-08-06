import { Badge } from "@everr/ui/components/badge";
import { buttonVariants } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
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
import { BookOpenText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { alertingConditionOperatorLabel } from "@/data/alerting/condition";
import { alertingQueries } from "@/data/alerting/queries";
import { pauseAlertingRule, resumeAlertingRule } from "@/data/alerting/server";
import type { AlertingAlert } from "@/data/alerting/types";
import {
  alertingRuleHandles,
  alertingRuleIdentity,
} from "@/data/alerts/rule-identity";
import { AlertEventFeed } from "./-components/alert-event-feed";
import {
  AlertingAlertStatusLabel,
  AlertingBackLink,
  AlertingDefRow,
  AlertingDisclosureTrigger,
  AlertingEmptyState,
  AlertingHealthHeart,
  AlertingPauseToggle,
  AlertingQueryError,
  AlertingSeverityBadge,
  alertingErrorMessage,
  alertingFormatTs,
  LabelSet,
} from "./-components/shared";

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
  const rule = useQuery(alertingQueries.ruleByName(project, slug, preview));
  const alerts = useQuery(alertingQueries.alerts(preview));
  const [sqlOpen, setSqlOpen] = useState(false);

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
    (a: AlertingAlert) => a.rule === ruleId && a.slo === undefined,
  );
  const annotations = Object.entries(r.spec.annotations ?? {});
  const scopeHandles = alertingRuleHandles(r);

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <AlertingBackLink to="/alerts/rules" label="Back to rules" />
          <h2 className="text-base font-semibold">{identity.name}</h2>
          {identity.name !== identity.shortId && (
            <span className="font-mono text-xs text-muted-foreground">
              {identity.shortId}
            </span>
          )}
          <AlertingSeverityBadge severity={r.spec.severity} />
          <AlertingHealthHeart status={r.health.status} />
          {r.spec.suppressed && (
            // Evaluates fully but never notifies — worth a loud flag.
            <Badge variant="destructive">suppressed</Badge>
          )}
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

      <Card>
        <CardHeader>
          <CardTitle>What is it</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
              {r.spec.resolve_after}
            </AlertingDefRow>
            <AlertingDefRow label="Label columns">
              {r.spec.label_columns.join(", ") || "—"}
            </AlertingDefRow>
            <AlertingDefRow label="Condition">
              <span className="font-mono">
                value{" "}
                {alertingConditionOperatorLabel(r.spec.condition.operator)}{" "}
                {r.spec.condition.threshold}
              </span>
            </AlertingDefRow>
            {annotations.length > 0 && (
              <AlertingDefRow label="Annotations">
                <span className="flex flex-col gap-0.5">
                  {annotations.map(([k, v]) => (
                    <span key={k}>
                      <span className="text-muted-foreground">{k}:</span> {v}
                    </span>
                  ))}
                </span>
              </AlertingDefRow>
            )}
          </dl>
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

      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>What&rsquo;s it doing</CardTitle>
        </CardHeader>
        <CardContent>
          {r.rollup && (
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
          )}
          {alerts.isPending ? (
            <div className="px-3 py-2">
              <Skeleton className="h-7 w-full" />
            </div>
          ) : (
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
          )}
        </CardContent>
      </Card>

      <AlertEventFeed preview={preview} scopeSlug={scopeHandles} />
    </div>
  );
}
