// Rule detail, organized by the questions an operator actually asks:
// What is it (spec facts, SQL behind a disclosure) and What's it doing
// (instances, rollup, the scoped event timeline).
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
import { AlertEventFeed } from "@/components/cc/alert-event-feed";
import {
  CcBackLink,
  CcDefRow,
  CcDisclosureTrigger,
  CcEmptyState,
  CcHealthHeart,
  CcInstanceStatusBadge,
  CcPauseToggle,
  CcQueryError,
  CcSeverityBadge,
  ccErrorMessage,
  ccFormatTs,
  LabelSet,
} from "@/components/cc/shared";
import { ccRuleHandles, ccRuleIdentity } from "@/data/alerts/rule-identity";
import { ccQueries } from "@/data/cc/queries";
import { pauseCcRule, resumeCcRule } from "@/data/cc/server";
import type { CcAlert } from "@/data/cc/types";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts/rules_/$project/$slug",
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
    // The rule first: the event timeline prefetch is scoped to its handles.
    const rule = await queryClient.ensureQueryData(
      ccQueries.ruleByName(params.project, params.slug, deps.preview),
    );
    await Promise.all([
      queryClient.prefetchQuery(ccQueries.alerts(deps.preview)),
      queryClient.prefetchQuery(
        ccQueries.eventHistory(deps.timeRange, {
          slugs: ccRuleHandles(rule),
          preview: deps.preview,
        }),
      ),
    ]);
  },
  component: CcRuleDetailPage,
});

// ── Page ──────────────────────────────────────────────────────────────────────

function CcRuleDetailPage() {
  const { project, slug } = Route.useParams();
  const { preview } = Route.useSearch();
  const qc = useQueryClient();
  const rule = useQuery(ccQueries.ruleByName(project, slug, preview));
  const alerts = useQuery(ccQueries.alerts(preview));
  const [sqlOpen, setSqlOpen] = useState(false);

  const toggle = useMutation({
    mutationFn: (paused: boolean) => {
      const ruleId = rule.data?.id;
      if (!ruleId) throw new Error("Rule not loaded");
      return paused
        ? resumeCcRule({ data: { ruleId } })
        : pauseCcRule({ data: { ruleId } });
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ccQueries.ruleByName(project, slug, preview).queryKey,
      });
      // The rules listing shows the paused state too.
      qc.invalidateQueries({ queryKey: ccQueries.rules().queryKey });
      toast.success("Rule updated");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  if (rule.isError) return <CcQueryError error={rule.error} />;

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
  const identity = ccRuleIdentity(r);
  // `a.rule` carries the source uuid for SLO-sourced instances too (CC's
  // wire convention), so exclude those explicitly: this page is rule scope.
  const ruleInstances = (alerts.data ?? []).filter(
    (a: CcAlert) => a.rule === ruleId && a.slo === undefined,
  );
  const annotations = Object.entries(r.spec.annotations ?? {});
  // Event rows carry the slug when CC knows it, the bare id otherwise, so the
  // feed scopes on both handles.
  const scopeHandles = ccRuleHandles(r);

  const instCols: Column<CcAlert>[] = [
    {
      header: "Status",
      cell: (a) => <CcInstanceStatusBadge status={a.status} />,
    },
    { header: "Labels", cell: (a) => <LabelSet labels={a.labels} /> },
    {
      header: "Value",
      cell: (a) => <span className="tabular-nums">{a.value ?? "—"}</span>,
    },
    { header: "Active since", cell: (a) => ccFormatTs(a.active_since) },
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
          <CcBackLink to="/alerts/rules" label="Back to rules" />
          <h2 className="text-base font-semibold">{identity.name}</h2>
          {identity.name !== identity.shortId && (
            <span className="font-mono text-xs text-muted-foreground">
              {identity.shortId}
            </span>
          )}
          <CcSeverityBadge severity={r.spec.severity} />
          <CcHealthHeart status={r.health.status} />
          {r.spec.suppressed && (
            // A suppressed rule evaluates fully but the dispatcher never
            // notifies on it — worth a loud flag, or the silence is invisible.
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
          <CcPauseToggle
            paused={r.paused}
            pending={toggle.isPending}
            kind="alert rule"
            name={ccRuleIdentity(r).name}
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
            <CcDefRow label="Interval">{r.spec.interval_secs}s</CcDefRow>
            {r.spec.max_interval_secs != null && (
              <CcDefRow label="Max interval">
                {r.spec.max_interval_secs}s
              </CcDefRow>
            )}
            <CcDefRow label="For">{r.spec.for_secs}s</CcDefRow>
            <CcDefRow label="Resolve after">{r.spec.resolve_after}</CcDefRow>
            <CcDefRow label="Label columns">
              {r.spec.label_columns.join(", ") || "—"}
            </CcDefRow>
            <CcDefRow label="Value column">
              {r.spec.value_column ?? "—"}
            </CcDefRow>
            {annotations.length > 0 && (
              <CcDefRow label="Annotations">
                <span className="flex flex-col gap-0.5">
                  {annotations.map(([k, v]) => (
                    <span key={k}>
                      <span className="text-muted-foreground">{k}:</span> {v}
                    </span>
                  ))}
                </span>
              </CcDefRow>
            )}
          </dl>
          {/* Authors have Git; readers get the SQL on demand, not as a wall. */}
          <Collapsible open={sqlOpen} onOpenChange={setSqlOpen}>
            <CcDisclosureTrigger open={sqlOpen}>
              <span className="text-xs font-medium">SQL</span>
              {!sqlOpen && (
                <span className="min-w-0 truncate font-mono text-[0.6875rem] text-muted-foreground">
                  {r.spec.sql}
                </span>
              )}
            </CcDisclosureTrigger>
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
                    title={ccFormatTs(ts)}
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
                <CcEmptyState
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
