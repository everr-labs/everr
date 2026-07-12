// Rule detail, organized by the questions an operator actually asks:
// What is it (spec facts, SQL behind a disclosure), What's it doing
// (instances, rollup, the scoped event timeline), Is it healthy (forensics,
// auto-expanded only when degraded), Try it (ad-hoc test evaluation).
import { Badge } from "@everr/ui/components/badge";
import { Button, buttonVariants } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@everr/ui/components/collapsible";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Skeleton } from "@everr/ui/components/skeleton";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { cn } from "@everr/ui/lib/utils";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  BookOpenText,
  ChevronRight,
  FlaskConical,
  Pause,
  Play,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertEventFeed,
  ccEventHistoryQueryOptions,
} from "@/components/cc/alert-event-feed";
import { PauseRuleButton } from "@/components/cc/pause-rule-button";
import { ccRuleIdentity } from "@/data/alerts/rule-identity";
import {
  CC_POLL_INTERVAL_MS,
  getCcRule,
  listCcAlerts,
  pauseCcRule,
  resumeCcRule,
  testCcRule,
} from "@/data/cc/server";
import type { CcAlert, CcRuleView, CcTestResult } from "@/data/cc/types";
import {
  CcEmptyState,
  CcHealthBadge,
  CcInstanceStatusBadge,
  CcQueryError,
  CcSeverityBadge,
  ccErrorMessage,
  ccFormatDuration,
  ccFormatTs,
  LabelSet,
} from "./-cc-shared";

const ccRuleQuery = (ruleId: string) =>
  queryOptions({
    queryKey: ["cc", "rule", ruleId],
    queryFn: () => getCcRule({ data: { ruleId } }),
  });
const ccAlertsQuery = () =>
  queryOptions({
    queryKey: ["cc", "alerts"],
    queryFn: () => listCcAlerts(),
    refetchInterval: CC_POLL_INTERVAL_MS,
  });

export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts/rules_/$ruleId",
)({
  staticData: {
    breadcrumb: "Rule",
    // The alerts section hides the global time-range picker; the scoped
    // event timeline below reads stored history, so this page opts back in.
    hideTimeRangePicker: false,
  },
  loaderDeps: ({ search }) => ({ timeRange: withTimeRange(search).timeRange }),
  loader: ({ context: { queryClient }, params, deps }) =>
    Promise.all([
      queryClient.prefetchQuery(ccRuleQuery(params.ruleId)),
      queryClient.prefetchQuery(ccAlertsQuery()),
      queryClient.prefetchQuery(ccEventHistoryQueryOptions(deps.timeRange)),
    ]),
  component: CcRuleDetailPage,
});

function BackLink() {
  return (
    <Link
      to="/alerts/rules"
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] hover:bg-muted/50 hover:text-foreground"
      aria-label="Back to rules"
    >
      <ArrowLeft className="size-4" />
    </Link>
  );
}

function DefRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <dt className="w-28 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs">{children}</dd>
    </div>
  );
}

// ── Is it healthy ─────────────────────────────────────────────────────────────

function HealthForensics({ health }: { health: CcRuleView["health"] }) {
  return (
    <dl className="divide-y divide-border/60">
      <DefRow label="Consecutive failures">
        {health.consecutive_failures}
      </DefRow>
      <DefRow label="Degraded since">
        {ccFormatTs(health.degraded_since)}
      </DefRow>
      <DefRow label="Last error">
        {health.last_error ? (
          <span className="break-all">{health.last_error}</span>
        ) : (
          "—"
        )}
      </DefRow>
      <DefRow label="Last error at">{ccFormatTs(health.last_error_at)}</DefRow>
    </dl>
  );
}

function HealthSection({ health }: { health: CcRuleView["health"] }) {
  const degraded = health.status === "degraded";
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Is it healthy</CardTitle>
      </CardHeader>
      <CardContent>
        {degraded ? (
          // Degraded is never collapsible: the forensics ARE the point.
          <div
            role="alert"
            className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlert className="size-4 shrink-0" />
              Evaluation degraded since {ccFormatTs(health.degraded_since)}
            </p>
            {health.last_error && (
              <p className="font-mono text-xs break-all opacity-90">
                {health.last_error}
              </p>
            )}
            <p className="text-xs opacity-90">
              {[
                health.consecutive_failures > 0
                  ? `${health.consecutive_failures} consecutive failure${
                      health.consecutive_failures === 1 ? "" : "s"
                    }`
                  : null,
                health.last_error_at
                  ? `last error at ${ccFormatTs(health.last_error_at)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        ) : (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-150 hover:text-foreground focus-visible:outline-primary">
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                  open && "rotate-90",
                )}
              />
              <CcHealthBadge status={health.status} />
              <span className="text-muted-foreground">
                ·{" "}
                {health.last_error_at
                  ? `last error ${ccFormatTs(health.last_error_at)}`
                  : "no failures on record"}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-1 pt-1">
                <HealthForensics health={health} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function CcRuleDetailPage() {
  const { ruleId } = Route.useParams();
  const qc = useQueryClient();
  const rule = useQuery(ccRuleQuery(ruleId));
  const alerts = useQuery(ccAlertsQuery());
  const [test, setTest] = useState<CcTestResult | null>(null);
  const [sqlOpen, setSqlOpen] = useState(false);

  const toggle = useMutation({
    mutationFn: (paused: boolean) =>
      paused
        ? resumeCcRule({ data: { ruleId } })
        : pauseCcRule({ data: { ruleId } }),
    onSuccess: (_, wasPaused) => {
      qc.invalidateQueries({ queryKey: ["cc", "rule", ruleId] });
      // The rules listing shows the paused state too.
      qc.invalidateQueries({ queryKey: ["cc", "rules"] });
      toast.success(wasPaused ? "Evaluation resumed" : "Evaluation paused");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });
  const runTest = useMutation({
    mutationFn: (spec: CcRuleView["spec"]) =>
      testCcRule({ data: { ruleId, spec } }),
    onSuccess: (r) => setTest(r),
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
  const identity = ccRuleIdentity(r);
  const ruleInstances = (alerts.data ?? []).filter(
    (a: CcAlert) => a.rule === ruleId,
  );
  const annotations = Object.entries(r.spec.annotations ?? {});
  // Event rows carry the slug when CC knows it, the bare id otherwise;
  // scope on both and resolve either back to the display name.
  const scopeHandles = identity.slug ? [r.id, identity.slug] : [r.id];

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
          {a.last_seen ? formatRelativeTime(a.last_seen) : "—"}
          {a.absent_count > 0 && ` · absent x${a.absent_count}`}
        </span>
      ),
    },
  ];

  const testCols: Column<CcTestResult["rows"][number]>[] = [
    { header: "Labels", cell: (row) => <LabelSet labels={row.labels} /> },
    {
      header: "Value",
      cell: (row) => <span className="tabular-nums">{row.value ?? "—"}</span>,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <BackLink />
          <h2 className="text-base font-semibold">{identity.name}</h2>
          {identity.name !== identity.shortId && (
            <span className="font-mono text-xs text-muted-foreground">
              {identity.shortId}
            </span>
          )}
          <CcSeverityBadge severity={r.spec.severity} />
          <CcHealthBadge status={r.health.status} />
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
          <PauseRuleButton
            name={identity.name}
            paused={r.paused}
            pending={toggle.isPending}
            onPause={() => toggle.mutate(r.paused)}
            onResume={() => toggle.mutate(r.paused)}
            longLabels
          />
        </div>
      </div>

      {r.paused && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-400"
        >
          <Pause className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Evaluation is paused: the engine is not running this rule, so no
            alerts fire and nothing notifies. Quiet here does not mean healthy.
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(true)}
          >
            <Play data-icon="inline-start" />
            Resume
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>What is it</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="divide-y divide-border/60">
            <DefRow label="Evaluates every">
              <span title={`evaluationInterval: ${r.spec.interval_secs}s`}>
                {ccFormatDuration(r.spec.interval_secs)}
              </span>
            </DefRow>
            {r.spec.max_interval_secs != null && (
              <DefRow label="Max interval">
                <span title="The adaptive-backoff ceiling: past this the rule is flagged degraded">
                  {ccFormatDuration(r.spec.max_interval_secs)}
                </span>
              </DefRow>
            )}
            <DefRow label="For">
              {r.spec.for_secs === 0 ? (
                <span title="for: 0s">fires on first match</span>
              ) : (
                <span
                  title={`for: ${r.spec.for_secs}s (the condition must hold this long before firing)`}
                >
                  {ccFormatDuration(r.spec.for_secs)} before firing
                </span>
              )}
            </DefRow>
            <DefRow label="Resolve after">
              <span title={`resolveAfter: ${r.spec.resolve_after}`}>
                {r.spec.resolve_after} empty{" "}
                {r.spec.resolve_after === 1 ? "evaluation" : "evaluations"}
              </span>
            </DefRow>
            <DefRow label="Label columns">
              {r.spec.label_columns.join(", ") || "—"}
            </DefRow>
            <DefRow label="Value column">{r.spec.value_column ?? "—"}</DefRow>
            {annotations.length > 0 && (
              <DefRow label="Annotations">
                <span className="flex flex-col gap-0.5">
                  {annotations.map(([k, v]) => (
                    <span key={k}>
                      <span className="text-muted-foreground">{k}:</span> {v}
                    </span>
                  ))}
                </span>
              </DefRow>
            )}
          </dl>
          {/* Authors have Git; readers get the SQL on demand, not as a wall. */}
          <Collapsible open={sqlOpen} onOpenChange={setSqlOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md border border-border bg-muted/20 px-3 py-2 text-left outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-150 hover:bg-muted/40 focus-visible:outline-primary">
              <ChevronRight
                className={cn(
                  "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                  sqlOpen && "rotate-90",
                )}
              />
              <span className="text-xs font-medium">SQL</span>
              {!sqlOpen && (
                <span className="min-w-0 truncate font-mono text-[0.6875rem] text-muted-foreground">
                  {r.spec.sql}
                </span>
              )}
            </CollapsibleTrigger>
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
                    {ts ? formatRelativeTime(ts) : "—"}
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

      <AlertEventFeed
        scopeSlug={scopeHandles}
        hideRuleColumns
        resolveRuleName={(handle) =>
          scopeHandles.includes(handle) ? identity.name : handle
        }
        resolveRuleSeverity={(handle) =>
          scopeHandles.includes(handle) ? r.spec.severity : undefined
        }
      />

      <HealthSection health={r.health} />

      <Card inset={test ? "flush-content" : "default"}>
        <CardHeader>
          <CardTitle>Try it</CardTitle>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              disabled={runTest.isPending}
              onClick={() => runTest.mutate(r.spec)}
            >
              <FlaskConical data-icon="inline-start" />
              {runTest.isPending ? "Running…" : "Run test"}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {test ? (
            <>
              <p className="px-3 pb-2 text-xs text-muted-foreground">
                Matched{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {test.matched}
                </span>{" "}
                row(s) — no state change.
              </p>
              <DataTable
                data={test.rows}
                columns={testCols}
                rowKey={(_, i) => String(i)}
                emptyState={
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    Matched {test.matched} row(s); none returned label sets.
                  </p>
                }
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Run an ad-hoc evaluation of this rule&rsquo;s current spec against
              ClickHouse, without changing any alert state.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
