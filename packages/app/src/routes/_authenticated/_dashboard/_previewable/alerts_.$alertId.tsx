import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { Skeleton } from "@everr/ui/components/skeleton";
import { Textarea } from "@everr/ui/components/textarea";
import { type TimeRange, withTimeRange } from "@everr/ui/lib/time-range";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import {
  BellOff,
  CircleCheck,
  CirclePlay,
  CircleStop,
  FlaskConical,
  Loader2,
  NotebookText,
  Plus,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { PreviewStatusBadge } from "@/components/preview-status-badge";
import {
  ALERT_CHANNELS,
  type AlertDeliveryTargets,
} from "@/data/alerts/delivery-settings";
import {
  type Matcher,
  NO_LABELS_TEXT,
  sortedLabelEntries,
} from "@/data/alerts/matchers";
import { formatRunbookRef } from "@/data/alerts/schema";
import {
  type AlertInstanceSummary,
  type AlertSilenceSummary,
  activateAlert,
  cancelSilence,
  createSilence,
  deactivateAlert,
  getAlert,
  listAlertEvents,
  listAlertInstances,
  listAlertSilences,
  testAlert,
} from "@/data/alerts/server";
import type { CcTestResult } from "@/data/cc/types";
import { useCcInvalidation } from "@/hooks/use-cc-invalidation";
import { useTimeRange } from "@/hooks/use-time-range";
import {
  formatDate,
  formatInterval,
  QueryErrorMessage,
  RelativeTime,
  SeverityBadge,
  stateVariant,
} from "./-alerts-shared";

const alertDetailQueryOptions = (alertId: string, preview?: string) =>
  queryOptions({
    queryKey: ["alerts", alertId, "detail", preview ?? ""],
    queryFn: () => getAlert({ data: { alertId, preview } }),
  });

const alertInstancesQueryOptions = (alertId: string, timeRange: TimeRange) =>
  queryOptions({
    queryKey: ["alerts", alertId, "instances", timeRange],
    queryFn: () => listAlertInstances({ data: { alertId, timeRange } }),
  });

const alertSilencesQueryOptions = (alertId: string) =>
  queryOptions({
    queryKey: ["alerts", alertId, "silences"],
    queryFn: () => listAlertSilences({ data: { alertId } }),
  });

const alertEventsQueryOptions = (alertId: string, timeRange: TimeRange) =>
  queryOptions({
    queryKey: ["alerts", alertId, "events", timeRange],
    queryFn: () => listAlertEvents({ data: { alertId, limit: 50, timeRange } }),
  });

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts_/$alertId",
)({
  staticData: {
    breadcrumb: (match: { loaderData?: { slug?: string } }) => [
      { label: "Alerts", to: "/alerts" },
      { label: match.loaderData?.slug ?? "Alert" },
    ],
  },
  head: () => ({ meta: [{ title: "Everr - Alert detail" }] }),
  // `preview` keys the detail query alongside the time range so the overlay
  // status refetches when the active preview changes.
  loaderDeps: ({ search }) => ({
    ...withTimeRange(search),
    preview: search.preview,
  }),
  loader: async ({ context: { queryClient }, params, deps }) => {
    const detailQuery = alertDetailQueryOptions(params.alertId, deps.preview);
    // Prefetch (non-throwing) rather than `ensureQueryData` so a failed load
    // renders the component's friendly "Alert not found." / "Unable to load
    // alert." branch instead of throwing to the route error boundary — matching
    // how the sibling CC pages prefetch.
    await Promise.all([
      queryClient.prefetchQuery(detailQuery),
      queryClient.prefetchQuery(
        alertInstancesQueryOptions(params.alertId, deps.timeRange),
      ),
      queryClient.prefetchQuery(alertSilencesQueryOptions(params.alertId)),
      queryClient.prefetchQuery(
        alertEventsQueryOptions(params.alertId, deps.timeRange),
      ),
    ]);
    // `previewStatus` rides the loaderData up to the `_previewable` layout,
    // which reads the deepest match carrying it to tone the preview bar. Read
    // it back from cache (undefined when the prefetch failed) so the loader
    // never throws.
    const detail = queryClient.getQueryData(detailQuery.queryKey);
    return { slug: detail?.slug, previewStatus: detail?.previewStatus };
  },
  component: AlertDetailPage,
});

// What SilenceDialog needs to prefill matchers: an instance's fingerprint and
// labels. Both the firing-instances row and a history event can produce one.
type SilenceTarget = {
  fingerprint: string;
  labels: Record<string, string>;
};

// A history-table row. Named because the silence column is now conditionally
// spread into the columns array, where the cell parameter is no longer
// inferred from the DataTable generic.
type AlertEventRow = Awaited<ReturnType<typeof listAlertEvents>>[number];

function AlertDetailPage() {
  useCcInvalidation();
  const { alertId } = Route.useParams();
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });
  const queryClient = useQueryClient();
  const { timeRange } = useTimeRange();
  const alert = useQuery(alertDetailQueryOptions(alertId, preview));
  const instances = useQuery(alertInstancesQueryOptions(alertId, timeRange));
  const silences = useQuery(alertSilencesQueryOptions(alertId));
  const events = useQuery(alertEventsQueryOptions(alertId, timeRange));
  const [silenceTarget, setSilenceTarget] = useState<SilenceTarget | null>(
    null,
  );
  const [newSilenceOpen, setNewSilenceOpen] = useState(false);
  const [testResult, setTestResult] = useState<CcTestResult | null>(null);

  const setActive = useMutation({
    mutationFn: (active: boolean) =>
      active
        ? activateAlert({ data: { alertId } })
        : deactivateAlert({ data: { alertId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  // Ad-hoc evaluation of the alert's current spec: no state change, so the
  // result is held in local state rather than the query cache.
  const runTest = useMutation({
    mutationFn: () => testAlert({ data: { alertId } }),
    onSuccess: (result) => setTestResult(result),
  });

  if (alert.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (alert.isError || !alert.data) {
    const notFound =
      alert.error instanceof Error && alert.error.message === "Alert not found";
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted-foreground" role="alert">
          {notFound ? "Alert not found." : "Unable to load alert."}
        </p>
        <Link to="/alerts" className="underline underline-offset-4">
          Back to alerts
        </Link>
      </div>
    );
  }
  const detail = alert.data;
  // A preview rule is a suppressed dress rehearsal owned by its preview:
  // read-only here (like dashboards/runbooks in preview), so the pause and
  // silence affordances are hidden — CC never notifies on it anyway.
  const isPreviewRule = detail.previewId !== null;
  const definitionRows: [string, ReactNode][] = [
    ["Repository", detail.repoid],
    ["Severity", <SeverityBadge key="sev" severity={detail.severity} />],
    ["Evaluation interval", formatInterval(detail.evaluationIntervalSeconds)],
    // Anti-flap knobs and the value column only appear when they deviate from
    // the defaults (fire immediately, resolve after one empty evaluation).
    ...(detail.forSeconds > 0
      ? ([["For", formatInterval(detail.forSeconds)]] satisfies [
          string,
          ReactNode,
        ][])
      : []),
    ...(detail.resolveAfter > 1
      ? ([
          ["Resolve after", `${detail.resolveAfter} empty evaluations`],
        ] satisfies [string, ReactNode][])
      : []),
    ...(detail.valueColumn
      ? ([["Value column", detail.valueColumn]] satisfies [string, ReactNode][])
      : []),
    ["Notification title", detail.notificationTitleTemplate],
    ["Notification description", detail.notificationDescriptionTemplate || "-"],
    ...(detail.instanceLabelColumns.length > 0
      ? ([
          ["Instance labels", detail.instanceLabelColumns.join(", ")],
        ] satisfies [string, ReactNode][])
      : []),
    ...(detail.runbookSlug
      ? ([
          [
            "Runbook",
            runbookLink(detail.runbookProject ?? "default", detail.runbookSlug),
          ],
        ] satisfies [string, ReactNode][])
      : []),
    ["Last seen", formatDate(detail.lastSeenAt)],
  ];

  const firingInstances = (instances.data ?? []).filter(
    (row) => row.state === "firing",
  );
  const showFiringSuccess = instances.isSuccess && firingInstances.length === 0;
  const silenceCount = silences.data?.length ?? 0;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2">
            <h1 className="font-mono text-xl font-bold tracking-tight">
              {detail.display.name || detail.slug}
            </h1>
            {isPreviewRule && (
              <Badge
                variant="secondary"
                title="Preview rule: evaluated by the alert engine, but notifications are suppressed."
              >
                preview
              </Badge>
            )}
            <PreviewStatusBadge status={detail.previewStatus} />
          </span>
          {detail.display.description && (
            <p className="max-w-3xl text-muted-foreground">
              {detail.display.description}
            </p>
          )}
          {setActive.error && (
            <p className="text-sm text-destructive" role="alert">
              {setActive.error.message}
            </p>
          )}
        </div>
        {!isPreviewRule &&
          (detail.active ? (
            <Button
              variant="destructive"
              size="sm"
              className="hidden md:inline-flex"
              disabled={setActive.isPending}
              onClick={() => setActive.mutate(false)}
            >
              <CircleStop data-icon="inline-start" />
              Pause Evaluation
            </Button>
          ) : (
            <Button
              size="sm"
              className="hidden md:inline-flex"
              disabled={setActive.isPending}
              onClick={() => setActive.mutate(true)}
            >
              <CirclePlay data-icon="inline-start" />
              Resume Evaluation
            </Button>
          ))}
      </div>

      {showFiringSuccess ? (
        <Card className="border-emerald-500/30 bg-emerald-500/5 py-3">
          <CardContent className="flex items-center gap-3">
            <CircleCheck className="size-5 shrink-0 text-emerald-500" />
            <p className="text-sm">
              <span className="font-medium text-foreground">
                You're all good.
              </span>{" "}
              <span className="text-muted-foreground">
                Nothing's firing right now.
              </span>
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card inset="flush-content">
          <CardHeader>
            <CardTitle>Firing instances</CardTitle>
          </CardHeader>
          <CardContent>
            {instances.isError ? (
              <QueryErrorMessage message="Unable to load alert instances." />
            ) : instances.isPending ? (
              <Skeleton className="m-3 h-36 w-full" />
            ) : (
              <DataTable
                stickyHeader
                data={firingInstances}
                rowClassName={(row) =>
                  row.silenced ? "opacity-50" : undefined
                }
                columns={
                  [
                    {
                      header: "Labels",
                      cell: (row) => (
                        <div className="flex items-center gap-2">
                          <span
                            className="size-1.5 shrink-0 rounded-full bg-destructive"
                            aria-hidden
                          />
                          <KeyValueList values={row.labels} />
                          {row.silenced && (
                            <Badge variant="secondary">silenced</Badge>
                          )}
                        </div>
                      ),
                    },
                    {
                      header: "Matched values",
                      // Column className replaces the DataTable defaults, so the
                      // middle-column padding is restated alongside the
                      // responsive hiding.
                      className: "hidden pb-2 pr-4 md:table-cell",
                      cellClassName: "hidden py-2 pr-4 md:table-cell",
                      cell: (row) => <LastEvaluationResult instance={row} />,
                    },
                    {
                      header: "Firing since",
                      cell: (row) => <RelativeTime value={row.lastFiredAt} />,
                    },
                    // Preview rules never notify, so there is nothing to
                    // silence — the action column disappears with the rest of
                    // the mutation affordances.
                    ...(isPreviewRule
                      ? []
                      : [
                          {
                            header: "",
                            cell: (row: AlertInstanceSummary) => (
                              <Button
                                variant="outline"
                                size="sm"
                                aria-label="Silence"
                                onClick={() => {
                                  setSilenceTarget(row);
                                  setNewSilenceOpen(false);
                                }}
                              >
                                <BellOff data-icon="inline-start" />
                                <span className="hidden md:inline">
                                  Silence
                                </span>
                              </Button>
                            ),
                          },
                        ]),
                  ] satisfies Column<AlertInstanceSummary>[]
                }
                rowKey={(row) => row.fingerprint}
              />
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="flex flex-col gap-3">
              <DefinitionTable rows={definitionRows} />
              {detail.healthError && (
                <pre className="max-h-32 overflow-auto rounded bg-muted/30 p-2 text-xs text-destructive">
                  {detail.healthError}
                </pre>
              )}

              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">Query</span>
                <pre className="max-h-72 overflow-auto rounded bg-muted/30 p-2 text-xs">
                  {detail.parsedQuery}
                </pre>
              </div>

              {!isPreviewRule && (
                <RunTest
                  isPending={runTest.isPending}
                  error={runTest.error}
                  onRun={() => runTest.mutate()}
                  result={testResult}
                />
              )}
            </div>

            <div className="grid h-fit grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2 text-xs">
              <dt className="flex items-center gap-1 text-muted-foreground">
                Silences
                {!isPreviewRule && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-5 cursor-pointer"
                    aria-label="Add silence"
                    onClick={() => {
                      setSilenceTarget(null);
                      setNewSilenceOpen(true);
                    }}
                  >
                    <Plus className="size-3" />
                  </Button>
                )}
              </dt>
              <dd className="min-w-0">
                {silences.isError ? (
                  <QueryErrorMessage message="Unable to load silences." />
                ) : silences.isPending ? (
                  <Skeleton className="h-5 w-full" />
                ) : silenceCount > 0 ? (
                  <div className="flex flex-col divide-y">
                    {silences.data?.map((silence) => (
                      <SilenceRow key={silence.id} silence={silence} />
                    ))}
                  </div>
                ) : null}
              </dd>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {events.isError ? (
            <QueryErrorMessage message="Unable to load alert history." />
          ) : events.isPending ? (
            <Skeleton className="m-3 h-36 w-full" />
          ) : (
            <DataTable
              stickyHeader
              data={events.data ?? []}
              columns={[
                { header: "Time", cell: (row) => formatDate(row.eventTime) },
                {
                  header: "State",
                  cell: (row) => (
                    <HistoryInstanceState instances={row.instances} />
                  ),
                },
                {
                  header: "Instance",
                  cell: (row) => <HistoryInstances instances={row.instances} />,
                },
                {
                  header: "Delivery",
                  cell: (row) => formatDeliveryTargets(row),
                },
                // See the firing-instances table: no silencing on preview
                // rules.
                ...(isPreviewRule
                  ? []
                  : [
                      {
                        header: "",
                        cell: (row: AlertEventRow) => {
                          const instance =
                            row.instances.find((i) => i.state === "firing") ??
                            row.instances[0];
                          return (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="cursor-pointer"
                              aria-label="Silence"
                              onClick={() => {
                                setSilenceTarget({
                                  fingerprint: row.eventId,
                                  labels: instance?.labels ?? {},
                                });
                                setNewSilenceOpen(false);
                              }}
                            >
                              <BellOff />
                            </Button>
                          );
                        },
                      },
                    ]),
              ]}
              rowKey={(row) => row.eventId}
              emptyState={
                <div className="px-3 py-6 text-center text-muted-foreground">
                  No alert events yet.
                </div>
              }
            />
          )}
        </CardContent>
      </Card>

      {!isPreviewRule && (
        <SilenceDialog
          alertId={alertId}
          instance={silenceTarget}
          open={newSilenceOpen}
          onClose={() => {
            setSilenceTarget(null);
            setNewSilenceOpen(false);
          }}
        />
      )}
    </div>
  );
}

// Run an ad-hoc evaluation of the alert's spec against ClickHouse without
// changing any state, mirroring the power-user rule page's "Run test": a button,
// a matched-row count, and a compact result table. An empty match is a
// first-class result (the alert would not fire), distinct from an error.
function RunTest({
  isPending,
  error,
  onRun,
  result,
}: {
  isPending: boolean;
  error: Error | null;
  onRun: () => void;
  result: CcTestResult | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">Test evaluation</span>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={onRun}
        >
          {isPending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <FlaskConical data-icon="inline-start" />
          )}
          {isPending ? "Running…" : "Run test"}
        </Button>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error.message}
        </p>
      )}
      {result &&
        (result.rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            0 rows — the alert would not fire. No state changed.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Matched{" "}
              <span className="font-medium text-foreground tabular-nums">
                {result.matched}
              </span>{" "}
              row(s) — no state changed.
            </p>
            <DataTable
              data={result.rows}
              columns={[
                {
                  header: "Labels",
                  cell: (row) => <KeyValueList values={row.labels} />,
                },
                {
                  header: "Value",
                  cell: (row) => (
                    <span className="font-mono text-xs tabular-nums">
                      {row.value ?? "-"}
                    </span>
                  ),
                },
              ]}
              rowKey={(_, i) => String(i)}
            />
          </div>
        ))}
    </div>
  );
}

function LastEvaluationResult({
  instance,
}: {
  instance: AlertInstanceSummary;
}) {
  if (instance.state !== "firing" || instance.lastEvaluationRows.length === 0) {
    return "-";
  }
  const rows = instance.lastEvaluationRows
    .map((row) => nonLabelValues(row, instance.labels))
    .filter((row) => Object.keys(row).length > 0);
  if (rows.length === 0) return "-";
  return (
    <div className="flex max-w-xl flex-col gap-1 font-mono text-xs">
      {rows.map((row, index) => (
        <KeyValueList key={index} values={row} />
      ))}
    </div>
  );
}

function KeyValueList({ values }: { values: Record<string, string> }) {
  const entries = sortedLabelEntries(values);
  if (entries.length === 0) {
    return <span className="font-mono text-xs">{NO_LABELS_TEXT}</span>;
  }
  return (
    <span className="flex max-w-full flex-wrap gap-x-2 gap-y-1 font-mono text-xs">
      {entries.map(([key, value]) => (
        <span key={key} className="min-w-0 break-all">
          {key}={value}
        </span>
      ))}
    </span>
  );
}

function DefinitionTable({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Deep-link an alert to its linked runbook. The link target lives in the CC
// rule's `everr.runbook` annotation (see data/alerts/mapping.ts).
function runbookLink(project: string, slug: string): ReactNode {
  return (
    <Link
      to="/runbooks/$project/$slug"
      params={{ project, slug }}
      className="inline-flex items-center gap-1.5 underline underline-offset-4"
    >
      <NotebookText className="size-4" />
      {formatRunbookRef(project, slug)}
    </Link>
  );
}

function nonLabelValues(
  row: Record<string, unknown>,
  labels: Record<string, string>,
) {
  // With explicit instanceLabels, labels only contains those configured columns.
  // Other string columns are evidence and must remain visible in Last result.
  return Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !(key in labels))
      .map(([key, value]) => [key, formatResultValue(value)]),
  );
}

function formatResultValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDeliveryTargets(row: {
  deliveryTargets: AlertDeliveryTargets;
  silenceId: string;
}) {
  if (row.silenceId) return "silenced";
  const targets = ALERT_CHANNELS.filter(
    (target) => (row.deliveryTargets[target]?.length ?? 0) > 0,
  );
  return targets.length > 0 ? targets.join(", ") : "-";
}

function HistoryInstances({
  instances,
}: {
  instances: {
    state: "firing" | "resolved";
    labels: Record<string, string>;
    evidence: Record<string, unknown> | null;
    evidenceTruncated: boolean;
  }[];
}) {
  if (instances.length === 0) return "-";
  return (
    <div className="flex max-w-xl flex-col gap-1.5 font-mono text-xs">
      {instances.map((instance, index) => (
        <div key={index} className="flex flex-col gap-1">
          <KeyValueList values={instance.labels} />
          <EvidenceChips
            evidence={instance.evidence}
            truncated={instance.evidenceTruncated}
          />
        </div>
      ))}
    </div>
  );
}

// CC evidence (source-row columns beyond the identity labels) rendered as compact
// key=value pills below an event's instance labels, mirroring the silence matcher
// chips so the History table stays visually consistent.
function EvidenceChips({
  evidence,
  truncated,
}: {
  evidence: Record<string, unknown> | null;
  truncated: boolean;
}) {
  const entries = evidence
    ? sortedLabelEntries(
        Object.fromEntries(
          Object.entries(evidence).map(([key, value]) => [
            key,
            formatEvidenceValue(value),
          ]),
        ),
      )
    : [];
  if (entries.length === 0 && !truncated) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {entries.map(([key, value]) => (
        <Badge key={key} variant="secondary" className="font-mono font-normal">
          {key}={value}
        </Badge>
      ))}
      {truncated && (
        <span className="text-muted-foreground">evidence truncated</span>
      )}
    </div>
  );
}

function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function HistoryInstanceState({
  instances,
}: {
  instances: { state: "firing" | "resolved" }[];
}) {
  const states = Array.from(
    new Set(instances.map((instance) => instance.state)),
  );
  if (states.length === 0) return "-";
  return (
    <div className="flex flex-wrap gap-1">
      {states.map((state) => (
        <Badge key={state} variant={stateVariant(state)}>
          {state}
        </Badge>
      ))}
    </div>
  );
}

function SilenceRow({ silence }: { silence: AlertSilenceSummary }) {
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => cancelSilence({ data: { silenceId: silence.id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
  return (
    <div className="flex flex-col gap-1 py-2 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {silence.matchers.length === 0 ? (
            <Badge variant="secondary">all instances</Badge>
          ) : (
            silence.matchers.map((m, i) => (
              <Badge
                key={i}
                variant="secondary"
                className="font-mono font-normal"
              >
                {m.label}
                {m.op}
                {m.value}
              </Badge>
            ))
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 cursor-pointer text-muted-foreground hover:text-destructive"
          aria-label="Cancel silence"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          <X />
        </Button>
      </div>
      <span className="text-muted-foreground text-xs">
        Until {formatDate(silence.endsAt)}
        {silence.reason ? ` · ${silence.reason}` : ""}
      </span>
      {cancel.error && (
        <span className="text-destructive text-xs" role="alert">
          {cancel.error.message}
        </span>
      )}
    </div>
  );
}

const MATCHER_OPS = ["=", "!=", "=~", "!~"] as const;

const SILENCE_DURATIONS = [
  { value: "1", label: "1 hour" },
  { value: "2", label: "2 hours" },
  { value: "4", label: "4 hours" },
  { value: "8", label: "8 hours" },
  { value: "24", label: "1 day" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
] as const;

// `hours` only ever holds a SILENCE_DURATIONS value.
function silenceEnd(hours: string): Date {
  return new Date(Date.now() + Number(hours) * 3_600_000);
}

function SilenceDialog({
  alertId,
  instance,
  open,
  onClose,
}: {
  alertId: string;
  instance: SilenceTarget | null;
  open?: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [matchers, setMatchers] = useState<Matcher[]>([]);
  const [hours, setHours] = useState("2");
  const [reason, setReason] = useState("");
  const [initializedFor, setInitializedFor] = useState<string | null>(null);

  if (instance && initializedFor !== instance.fingerprint) {
    setMatchers(
      Object.entries(instance.labels).map(([label, value]) => ({
        label,
        op: "=" as const,
        value,
      })),
    );
    setHours("2");
    setReason("");
    setInitializedFor(instance.fingerprint);
  }

  const patchMatcher = (index: number, patch: Partial<Matcher>) =>
    setMatchers((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    );

  const create = useMutation({
    mutationFn: () =>
      createSilence({
        data: {
          alertId,
          endsAt: silenceEnd(hours).toISOString(),
          reason,
          matchers,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      onClose();
      setInitializedFor(null);
    },
  });

  return (
    <Dialog
      open={instance !== null || (open ?? false)}
      onOpenChange={(dialogOpen) => {
        if (!dialogOpen) {
          onClose();
          setInitializedFor(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Silence instances</DialogTitle>
          <DialogDescription>
            Notifications are paused for instances matching all matchers.
            Evaluation continues.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Matchers</Label>
            {matchers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No matchers: silences every instance of this rule.
              </p>
            )}
            {matchers.map((matcher, index) => (
              <div
                key={index}
                className="grid grid-cols-[1fr_72px_1fr_28px] items-center gap-1.5"
              >
                <Input
                  aria-label="Label"
                  placeholder="label"
                  className="font-mono"
                  value={matcher.label}
                  onChange={(event) =>
                    patchMatcher(index, { label: event.target.value })
                  }
                />
                <Select
                  value={matcher.op}
                  onValueChange={(op) =>
                    patchMatcher(index, { op: op as Matcher["op"] })
                  }
                >
                  <SelectTrigger aria-label="Operator" className="font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MATCHER_OPS.map((op) => (
                      <SelectItem key={op} value={op} className="font-mono">
                        {op}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label="Value"
                  placeholder="value"
                  className="font-mono"
                  value={matcher.value}
                  onChange={(event) =>
                    patchMatcher(index, { value: event.target.value })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove matcher"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    setMatchers((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                setMatchers((prev) => [
                  ...prev,
                  { label: "", op: "=", value: "" },
                ])
              }
            >
              <Plus data-icon="inline-start" />
              Add matcher
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="silence-duration">Duration</Label>
            <Select
              value={hours}
              onValueChange={(value) => value && setHours(value)}
            >
              <SelectTrigger id="silence-duration" className="w-full">
                <SelectValue>
                  {SILENCE_DURATIONS.find((d) => d.value === hours)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SILENCE_DURATIONS.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Silenced until {formatDate(silenceEnd(hours))}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="silence-reason">
              Reason{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="silence-reason"
              placeholder="Why are these instances silenced?"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {create.error && (
            <p className="text-sm text-destructive" role="alert">
              {create.error.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={create.isPending || matchers.some((m) => !m.label)}
            onClick={() => create.mutate()}
          >
            <BellOff data-icon="inline-start" />
            Create silence
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
