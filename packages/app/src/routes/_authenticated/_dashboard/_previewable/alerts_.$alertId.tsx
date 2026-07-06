import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
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
import { DataTable } from "@everr/ui/components/data-table";
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
  ChevronRight,
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
import { AlertEventFeed } from "@/components/cc/alert-event-feed";
import { computeNotifiesChannels, joinWithAnd } from "@/components/cc/notifies";
import { LabelSet } from "@/components/cc/shared";
import { PreviewStatusBadge } from "@/components/preview-status-badge";
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
  listAlertInstances,
  listAlertSilences,
  testAlert,
} from "@/data/alerts/server";
import { listCcRoutes } from "@/data/cc/server";
import type { CcTestResult } from "@/data/cc/types";
import { useCcInvalidation } from "@/hooks/use-cc-invalidation";
import { useTimeRange } from "@/hooks/use-time-range";
import {
  formatDate,
  formatInterval,
  QueryErrorMessage,
  RelativeTime,
  SeverityBadge,
} from "./-alerts-shared";
import { alertSettingsQueryOptions } from "./alerts";

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

// Same cache key route-builder.tsx/notifications.tsx use, so a route
// created/edited there is reflected here without a page reload.
const ccRoutesQueryOptions = () =>
  queryOptions({ queryKey: ["cc", "routes"], queryFn: () => listCcRoutes() });

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
      queryClient.prefetchQuery(alertSettingsQueryOptions()),
      queryClient.prefetchQuery(ccRoutesQueryOptions()),
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

// What MuteDialog needs to prefill matchers: a firing instance's fingerprint
// and labels.
type MuteTarget = {
  fingerprint: string;
  labels: Record<string, string>;
};

function AlertDetailPage() {
  useCcInvalidation();
  const { alertId } = Route.useParams();
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });
  const queryClient = useQueryClient();
  const { timeRange } = useTimeRange();
  const alert = useQuery(alertDetailQueryOptions(alertId, preview));
  const instances = useQuery(alertInstancesQueryOptions(alertId, timeRange));
  const silences = useQuery(alertSilencesQueryOptions(alertId));
  const settings = useQuery(alertSettingsQueryOptions());
  const routes = useQuery(ccRoutesQueryOptions());
  const [muteTarget, setMuteTarget] = useState<MuteTarget | null>(null);
  const [newMuteOpen, setNewMuteOpen] = useState(false);
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
  // mute affordances are hidden — CC never notifies on it anyway.
  const isPreviewRule = detail.previewId !== null;
  // The CC emitter (slug_for) writes/reads history keyed by everr.name when
  // present, and falls back to the rule id for bare rules (mirrors
  // listAlertEvents' server-side fallback) — the timeline must scope on the
  // same identity or a bare rule's events never match.
  const scopeSlug = detail.slug || detail.id;

  const definitionRows: [string, ReactNode][] = [
    ["Repository", detail.repoid],
    ["Severity", <SeverityBadge key="sev" severity={detail.severity} />],
    ["Checks every", formatInterval(detail.evaluationIntervalSeconds)],
    // Anti-flap knobs and the value column only appear when they deviate from
    // the defaults (fire immediately, resolve after one empty evaluation).
    ...(detail.forSeconds > 0
      ? ([["Must persist for", formatInterval(detail.forSeconds)]] satisfies [
          string,
          ReactNode,
        ][])
      : []),
    ...(detail.resolveAfter > 1
      ? ([
          ["Resolves after", `${detail.resolveAfter} empty evaluations`],
        ] satisfies [string, ReactNode][])
      : []),
    ...(detail.valueColumn
      ? ([["Value column", detail.valueColumn]] satisfies [string, ReactNode][])
      : []),
    ["Notification title", detail.notificationTitleTemplate],
    ["Notification description", detail.notificationDescriptionTemplate || "-"],
    ...(detail.instanceLabelColumns.length > 0
      ? ([["Label columns", detail.instanceLabelColumns.join(", ")]] satisfies [
          string,
          ReactNode,
        ][])
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
  const muteCount = silences.data?.length ?? 0;

  const notifiesChannels = computeNotifiesChannels({
    delivery: settings.data?.delivery,
    routes: routes.data ?? [],
    labelSets:
      firingInstances.length > 0
        ? firingInstances.map((row) => row.labels)
        : [{ severity: detail.severity }],
  });

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2">
            <h1 className="font-mono text-xl font-bold tracking-tight">
              {detail.display.name || detail.slug || detail.id}
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

      {/* 1. Status: "Firing on ..." per label set, or "All clear". */}
      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          {instances.isError ? (
            <QueryErrorMessage message="Unable to load current status." />
          ) : instances.isPending ? (
            <Skeleton className="m-3 h-24 w-full" />
          ) : firingInstances.length === 0 ? (
            <div className="flex items-center gap-3 px-3 py-3">
              <CircleCheck className="size-5 shrink-0 text-emerald-500" />
              <p className="text-sm">
                <span className="font-medium text-foreground">All clear.</span>{" "}
                <span className="text-muted-foreground">
                  Nothing's firing right now.
                </span>
              </p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y">
              {firingInstances.map((row) => (
                <li
                  key={row.fingerprint}
                  className="flex flex-wrap items-center justify-between gap-3 px-3 py-3"
                >
                  <div className="flex flex-col gap-1.5">
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      Firing on
                      {row.silenced && <Badge variant="secondary">muted</Badge>}
                    </span>
                    <LabelSet labels={row.labels} />
                    <LastEvaluationResult instance={row} />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>
                      since <RelativeTime value={row.lastFiredAt} />
                    </span>
                    {!isPreviewRule && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setMuteTarget(row);
                          setNewMuteOpen(false);
                        }}
                      >
                        <BellOff data-icon="inline-start" />
                        Mute
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 2. Timeline: stored+live merged event feed, scoped to this alert. */}
      <div className="flex flex-col gap-2">
        <CardTitle>Timeline</CardTitle>
        <AlertEventFeed scopeSlug={scopeSlug} />
      </div>

      {/* 3. Definition: plain-language spec facts, SQL collapsed. */}
      <Card>
        <CardHeader>
          <CardTitle>Definition</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <DefinitionTable rows={definitionRows} />
            {detail.healthError && (
              <pre className="max-h-32 overflow-auto rounded bg-muted/30 p-2 text-xs text-destructive">
                {detail.healthError}
              </pre>
            )}

            <Collapsible defaultOpen={false}>
              <CollapsibleTrigger className="group inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
                SQL
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="mt-1.5 max-h-72 overflow-auto rounded bg-muted/30 p-2 text-xs">
                  {detail.parsedQuery}
                </pre>
              </CollapsibleContent>
            </Collapsible>

            {!isPreviewRule && (
              <RunTest
                isPending={runTest.isPending}
                error={runTest.error}
                onRun={() => runTest.mutate()}
                result={testResult}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* 4. Notifies: default channels + the first matching custom rule. */}
      <Card>
        <CardHeader>
          <CardTitle>Notifies</CardTitle>
        </CardHeader>
        <CardContent>
          {settings.isError || routes.isError ? (
            <QueryErrorMessage message="Unable to load notification settings." />
          ) : settings.isPending || routes.isPending ? (
            <Skeleton className="h-5 w-full" />
          ) : notifiesChannels.length > 0 ? (
            <p className="text-sm">Notifies {joinWithAnd(notifiesChannels)}.</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No channels configured.{" "}
              <Link
                to="/alerts/notifications"
                className="underline underline-offset-4"
              >
                Configure notifications
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      {/* 5. Mutes: active mutes + the one-click mute dialog. */}
      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>Mutes</CardTitle>
          {!isPreviewRule && (
            <CardAction>
              <Button
                size="icon"
                variant="ghost"
                className="size-6 cursor-pointer"
                aria-label="Add mute"
                onClick={() => {
                  setMuteTarget(null);
                  setNewMuteOpen(true);
                }}
              >
                <Plus className="size-3.5" />
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {silences.isError ? (
            <QueryErrorMessage message="Unable to load mutes." />
          ) : silences.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : muteCount > 0 ? (
            <div className="flex flex-col divide-y px-3">
              {silences.data?.map((mute) => (
                <MuteRow key={mute.id} mute={mute} />
              ))}
            </div>
          ) : (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              No mutes active.
            </p>
          )}
        </CardContent>
      </Card>

      {!isPreviewRule && (
        <MuteDialog
          alertId={alertId}
          instance={muteTarget}
          open={newMuteOpen}
          onClose={() => {
            setMuteTarget(null);
            setNewMuteOpen(false);
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
    return null;
  }
  const rows = instance.lastEvaluationRows
    .map((row) => nonLabelValues(row, instance.labels))
    .filter((row) => Object.keys(row).length > 0);
  if (rows.length === 0) return null;
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
  // Other string columns are evidence and must remain visible in the last
  // evaluation's result.
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

// ---------------------------------------------------------------------------
// Mutes
// ---------------------------------------------------------------------------

function MuteRow({ mute }: { mute: AlertSilenceSummary }) {
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => cancelSilence({ data: { silenceId: mute.id } }),
    onSuccess: async () => {
      // Both keys: the home mutes pill reads ["cc","silences"], which the SSE
      // invalidation wave deliberately skips for config queries.
      await queryClient.invalidateQueries({ queryKey: ["cc", "silences"] });
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
  return (
    <div className="flex flex-col gap-1 py-2 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {mute.matchers.length === 0 ? (
            <Badge variant="secondary">all alerts</Badge>
          ) : (
            mute.matchers.map((m, i) => (
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
          aria-label="Cancel mute"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          <X />
        </Button>
      </div>
      <span className="text-muted-foreground text-xs">
        Until {formatDate(mute.endsAt)}
        {mute.reason ? ` · ${mute.reason}` : ""}
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

const MUTE_PRESETS = [
  { hours: "1", label: "1h" },
  { hours: "8", label: "8h" },
  { hours: "24", label: "24h" },
] as const;

// `hours` only ever holds a MUTE_PRESETS value or a custom hour count.
function muteEnd(hours: string): Date {
  const n = Number(hours);
  return new Date(Date.now() + (Number.isFinite(n) ? n : 0) * 3_600_000);
}

function MuteDialog({
  alertId,
  instance,
  open,
  onClose,
}: {
  alertId: string;
  instance: MuteTarget | null;
  open?: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [matchers, setMatchers] = useState<Matcher[]>([]);
  const [duration, setDuration] = useState<string>("1");
  const [customHours, setCustomHours] = useState("2");
  const [reason, setReason] = useState("");
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);

  if (instance && initializedFor !== instance.fingerprint) {
    setMatchers(
      Object.entries(instance.labels).map(([label, value]) => ({
        label,
        op: "=" as const,
        value,
      })),
    );
    setDuration("1");
    setReason("");
    setLabelsOpen(true);
    setInitializedFor(instance.fingerprint);
  }

  const effectiveHours = duration === "custom" ? customHours : duration;
  const parsedCustomHours = Number(customHours);
  const customHoursInvalid =
    duration === "custom" &&
    (!Number.isFinite(parsedCustomHours) || parsedCustomHours <= 0);

  const patchMatcher = (index: number, patch: Partial<Matcher>) =>
    setMatchers((prev) =>
      prev.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    );

  function reset() {
    setMatchers([]);
    setDuration("1");
    setCustomHours("2");
    setReason("");
    setLabelsOpen(false);
    setInitializedFor(null);
  }

  const create = useMutation({
    mutationFn: () =>
      createSilence({
        data: {
          alertId,
          endsAt: muteEnd(effectiveHours).toISOString(),
          reason,
          matchers,
        },
      }),
    onSuccess: async () => {
      // Both keys: keeps the home mutes pill in sync (see MuteRow cancel).
      await queryClient.invalidateQueries({ queryKey: ["cc", "silences"] });
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
      onClose();
      reset();
    },
  });

  return (
    <Dialog
      open={instance !== null || (open ?? false)}
      onOpenChange={(dialogOpen) => {
        if (!dialogOpen) {
          onClose();
          reset();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mute alert</DialogTitle>
          <DialogDescription>
            Notifications pause while conditions match. Evaluation continues.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
            <legend className="p-0 text-xs/relaxed font-medium">
              Duration
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {MUTE_PRESETS.map((preset) => (
                <Button
                  key={preset.hours}
                  type="button"
                  variant={duration === preset.hours ? "default" : "outline"}
                  size="sm"
                  aria-pressed={duration === preset.hours}
                  onClick={() => setDuration(preset.hours)}
                >
                  {preset.label}
                </Button>
              ))}
              <Button
                type="button"
                variant={duration === "custom" ? "default" : "outline"}
                size="sm"
                aria-pressed={duration === "custom"}
                onClick={() => setDuration("custom")}
              >
                Custom
              </Button>
            </div>
            {duration === "custom" && (
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Custom duration in hours"
                  type="number"
                  min={1}
                  className="w-20 tabular-nums"
                  value={customHours}
                  onChange={(event) => setCustomHours(event.target.value)}
                />
                <span className="text-xs text-muted-foreground">hours</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Muted until {formatDate(muteEnd(effectiveHours))}
            </p>
          </fieldset>

          <Collapsible
            open={labelsOpen}
            onOpenChange={(next) => setLabelsOpen(next)}
          >
            <CollapsibleTrigger className="group inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
              Match specific labels
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-2 pt-2">
                {matchers.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No conditions: mutes every alert from this rule.
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
                      <SelectTrigger
                        aria-label="Operator"
                        className="font-mono"
                      >
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
                      aria-label="Remove condition"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        setMatchers((prev) =>
                          prev.filter((_, i) => i !== index),
                        )
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
                  Add condition
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex flex-col gap-2">
            <Label htmlFor="mute-reason">
              Reason{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="mute-reason"
              placeholder="Why mute these alerts?"
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
          <Button
            variant="outline"
            onClick={() => {
              onClose();
              reset();
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={
              create.isPending ||
              matchers.some((m) => !m.label) ||
              customHoursInvalid
            }
            onClick={() => create.mutate()}
          >
            <BellOff data-icon="inline-start" />
            Create mute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
