import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Skeleton } from "@everr/ui/components/skeleton";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  FlaskConical,
  Pause,
  Play,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  getCcRule,
  listCcAlerts,
  pauseCcRule,
  resumeCcRule,
  testCcRule,
} from "@/data/cc/server";
import type { CcAlert, CcTestResult } from "@/data/cc/types";
import {
  CcEmptyState,
  CcHealthBadge,
  CcInstanceStatusBadge,
  CcQueryError,
  CcSeverityBadge,
  ccErrorMessage,
  ccFormatTs,
  LabelSet,
} from "./-cc-shared";

const ccRuleQuery = (ruleId: string) =>
  queryOptions({
    queryKey: ["cc", "rule", ruleId],
    queryFn: () => getCcRule({ data: { ruleId } }),
  });
const ccAlertsQuery = () =>
  queryOptions({ queryKey: ["cc", "alerts"], queryFn: () => listCcAlerts() });

export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/rules_/$ruleId",
)({
  staticData: { breadcrumb: "Rule" },
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient.prefetchQuery(ccRuleQuery(params.ruleId)),
      queryClient.prefetchQuery(ccAlertsQuery()),
    ]),
  component: CcRuleDetailPage,
});

function BackLink() {
  return (
    <Link
      to="/cc-alerting/rules"
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

function CcRuleDetailPage() {
  const { ruleId } = Route.useParams();
  const qc = useQueryClient();
  const rule = useQuery(ccRuleQuery(ruleId));
  const alerts = useQuery(ccAlertsQuery());
  const [test, setTest] = useState<CcTestResult | null>(null);

  const toggle = useMutation({
    mutationFn: (paused: boolean) =>
      paused
        ? resumeCcRule({ data: { ruleId } })
        : pauseCcRule({ data: { ruleId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "rule", ruleId] });
      toast.success("Rule updated");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });
  const runTest = useMutation({
    mutationFn: () => testCcRule({ data: { ruleId, spec: rule.data!.spec } }),
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
  const ruleInstances = (alerts.data ?? []).filter(
    (a: CcAlert) => a.rule === ruleId,
  );
  const annotations = Object.entries(r.spec.annotations ?? {});

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
        <div className="flex items-center gap-3">
          <BackLink />
          <h2 className="font-mono text-base font-semibold">
            {r.id.slice(0, 8)}
          </h2>
          <CcSeverityBadge severity={r.spec.severity} />
          <CcHealthBadge status={r.health.status} />
        </div>
        <Button
          variant="outline"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate(r.paused)}
        >
          {r.paused ? (
            <Play data-icon="inline-start" />
          ) : (
            <Pause data-icon="inline-start" />
          )}
          {r.paused ? "Resume" : "Pause"}
        </Button>
      </div>

      {r.health.status === "degraded" && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">
              Evaluation degraded since {ccFormatTs(r.health.degraded_since)}
            </p>
            {r.health.last_error && (
              <p className="mt-0.5 font-mono text-xs break-all opacity-90">
                {r.health.last_error}
              </p>
            )}
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Spec</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs ring-1 ring-foreground/10">
            {r.spec.sql}
          </pre>
          <dl className="divide-y divide-border/60">
            <DefRow label="Interval">{r.spec.interval_secs}s</DefRow>
            <DefRow label="For">{r.spec.for_secs}s</DefRow>
            <DefRow label="Resolve after">{r.spec.resolve_after}</DefRow>
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
        </CardContent>
      </Card>

      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>Firing instances</CardTitle>
        </CardHeader>
        <CardContent>
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

      <Card inset={test ? "flush-content" : "default"}>
        <CardHeader>
          <CardTitle>Test evaluation</CardTitle>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              disabled={runTest.isPending}
              onClick={() => runTest.mutate()}
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
