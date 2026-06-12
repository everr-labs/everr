import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { createFileRoute, Link } from "@tanstack/react-router";
import { BellOff, CirclePlay, CircleStop, Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  ALERT_CHANNELS,
  type AlertDeliveryTargets,
} from "@/data/alerts/delivery-settings";
import {
  type Matcher,
  NO_LABELS_TEXT,
  sortedLabelEntries,
} from "@/data/alerts/matchers";
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
} from "@/data/alerts/server";
import { useTimeRange } from "@/hooks/use-time-range";
import {
  AlertStateBadges,
  formatDate,
  formatInterval,
  stateVariant,
} from "./-alerts-shared";

const alertDetailQueryOptions = (alertId: string) =>
  queryOptions({
    queryKey: ["alerts", alertId],
    queryFn: () => getAlert({ data: { alertId } }),
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
  "/_authenticated/_dashboard/alerts_/$alertId",
)({
  staticData: {
    breadcrumb: (match: { loaderData?: { slug?: string } }) => [
      { label: "Alerts", to: "/alerts" },
      { label: match.loaderData?.slug ?? "Alert" },
    ],
  },
  head: () => ({ meta: [{ title: "Everr - Alert detail" }] }),
  loaderDeps: ({ search }) => withTimeRange(search),
  loader: async ({ context: { queryClient }, params, deps }) => {
    const [detail] = await Promise.all([
      queryClient.ensureQueryData(alertDetailQueryOptions(params.alertId)),
      queryClient.prefetchQuery(
        alertInstancesQueryOptions(params.alertId, deps.timeRange),
      ),
      queryClient.prefetchQuery(alertSilencesQueryOptions(params.alertId)),
      queryClient.prefetchQuery(
        alertEventsQueryOptions(params.alertId, deps.timeRange),
      ),
    ]);
    return { slug: detail.slug };
  },
  component: AlertDetailPage,
});

function AlertDetailPage() {
  const { alertId } = Route.useParams();
  const queryClient = useQueryClient();
  const { timeRange } = useTimeRange();
  const alert = useQuery(alertDetailQueryOptions(alertId));
  const instances = useQuery(alertInstancesQueryOptions(alertId, timeRange));
  const silences = useQuery(alertSilencesQueryOptions(alertId));
  const events = useQuery(alertEventsQueryOptions(alertId, timeRange));
  const [silenceTarget, setSilenceTarget] =
    useState<AlertInstanceSummary | null>(null);

  const deactivate = useMutation({
    mutationFn: () => deactivateAlert({ data: { alertId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  const activate = useMutation({
    mutationFn: () => activateAlert({ data: { alertId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  if (alert.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (alert.isError || !alert.data) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted-foreground">Alert not found.</p>
        <Link to="/alerts" className="underline underline-offset-4">
          Back to alerts
        </Link>
      </div>
    );
  }
  const detail = alert.data;
  const definitionRows: [string, ReactNode][] = [
    ["Evaluation interval", formatInterval(detail.evaluationIntervalSeconds)],
    ["Summary", detail.summaryTemplate],
    ["Description", detail.descriptionTemplate || "-"],
    ...(detail.instanceLabelColumns.length > 0
      ? ([
          ["Instance labels", detail.instanceLabelColumns.join(", ")],
        ] satisfies [string, ReactNode][])
      : []),
    ["Last evaluated", formatDate(detail.lastEvaluatedAt)],
  ];

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-xl font-bold tracking-tight">
              {detail.slug}
            </h1>
            <AlertStateBadges
              state={detail.currentState}
              active={detail.active}
              firingInstanceCount={detail.firingInstanceCount}
              silenced={
                detail.currentState === "firing" &&
                detail.activeSilenceCount > 0
              }
            />
          </div>
          <p className="text-muted-foreground">
            {detail.repoid}
            {detail.sourceLink && (
              <>
                {" · "}
                <a className="underline" href={detail.sourceLink}>
                  source
                </a>
              </>
            )}
          </p>
        </div>
        {detail.active ? (
          <Button
            variant="destructive"
            size="sm"
            className="hidden md:inline-flex"
            disabled={deactivate.isPending}
            onClick={() => deactivate.mutate()}
          >
            <CircleStop data-icon="inline-start" />
            Deactivate
          </Button>
        ) : (
          <Button
            size="sm"
            className="hidden md:inline-flex"
            disabled={activate.isPending}
            onClick={() => activate.mutate()}
          >
            <CirclePlay data-icon="inline-start" />
            Activate
          </Button>
        )}
      </div>

      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>Instances</CardTitle>
          <CardDescription>
            One row per alert instance. Silence an instance to pause its
            notifications.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {instances.isPending ? (
            <Skeleton className="m-3 h-36 w-full" />
          ) : (
            <DataTable
              stickyHeader
              data={instances.data ?? []}
              columns={
                [
                  {
                    header: "Labels",
                    cell: (row) => <KeyValueList values={row.labels} />,
                  },
                  {
                    header: "State",
                    cell: (row) => (
                      <div className="flex items-center gap-2">
                        <Badge variant={stateVariant(row.state)}>
                          {row.state}
                        </Badge>
                        {row.state === "firing" && row.silenced && (
                          <Badge variant="secondary">silenced</Badge>
                        )}
                      </div>
                    ),
                  },
                  {
                    header: "Last result",
                    // Column className replaces the DataTable defaults, so the
                    // middle-column padding is restated alongside the
                    // responsive hiding.
                    className: "hidden pb-2 pr-4 md:table-cell",
                    cellClassName: "hidden py-2 pr-4 md:table-cell",
                    cell: (row) => <LastEvaluationResult instance={row} />,
                  },
                  {
                    header: "Fired",
                    cell: (row) => formatDate(row.lastFiredAt),
                  },
                  {
                    header: "Resolved",
                    cell: (row) =>
                      row.state === "resolved"
                        ? formatDate(row.lastResolvedAt)
                        : "-",
                  },
                  {
                    header: "",
                    cell: (row) => (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label="Silence"
                        onClick={() => setSilenceTarget(row)}
                      >
                        <BellOff data-icon="inline-start" />
                        <span className="hidden md:inline">Silence</span>
                      </Button>
                    ),
                  },
                ] satisfies Column<AlertInstanceSummary>[]
              }
              rowKey={(row) => row.fingerprint}
              emptyState={
                <div className="px-3 py-8 text-center text-muted-foreground">
                  No alert instances recorded yet.
                </div>
              }
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Definition</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <DefinitionTable rows={definitionRows} />
            {detail.lastEvaluationError && (
              <pre className="max-h-32 overflow-auto rounded bg-muted/30 p-2 text-xs text-destructive">
                {detail.lastEvaluationError}
              </pre>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">Query</span>
              <pre className="max-h-72 overflow-auto rounded bg-muted/30 p-2 text-xs">
                {detail.parsedQuery}
              </pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active silences</CardTitle>
            <CardDescription>
              Created from instances; matching instances stop notifying.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {silences.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : (silences.data?.length ?? 0) === 0 ? (
              <p className="text-muted-foreground">No active silences.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {silences.data?.map((silence) => (
                  <SilenceRow key={silence.id} silence={silence} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {events.isPending ? (
            <Skeleton className="m-3 h-36 w-full" />
          ) : (
            <DataTable
              stickyHeader
              data={events.data ?? []}
              columns={[
                { header: "Time", cell: (row) => formatDate(row.eventTime) },
                { header: "Type", cell: (row) => row.eventType },
                {
                  header: "State",
                  cell: (row) => (
                    <HistoryInstanceState instances={row.instances} />
                  ),
                },
                {
                  header: "Instances",
                  cell: (row) => <HistoryInstances instances={row.instances} />,
                },
                { header: "Rows", cell: (row) => row.rowCount },
                {
                  header: "Delivery",
                  cell: (row) => formatDeliveryTargets(row),
                },
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

      <SilenceDialog
        alertId={alertId}
        instance={silenceTarget}
        onClose={() => setSilenceTarget(null)}
      />
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
  }[];
}) {
  if (instances.length === 0) return "-";
  return (
    <div className="flex max-w-xl flex-col gap-1 font-mono text-xs">
      {instances.map((instance, index) => (
        <KeyValueList key={index} values={instance.labels} />
      ))}
    </div>
  );
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
    <div className="flex items-start justify-between gap-2 rounded-md border bg-muted/30 p-3">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs">
          {silence.matchers.length === 0
            ? "(all instances)"
            : silence.matchers
                .map((m) => `${m.label}${m.op}"${m.value}"`)
                .join(" ")}
        </span>
        <span className="text-xs text-muted-foreground">
          Until {formatDate(silence.endsAt)}
          {silence.reason ? ` · ${silence.reason}` : ""}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={cancel.isPending}
        onClick={() => cancel.mutate()}
      >
        <X data-icon="inline-start" />
        Cancel
      </Button>
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

function silenceEnd(hours: string): Date {
  return new Date(Date.now() + Math.max(Number(hours) || 1, 1) * 3_600_000);
}

function SilenceDialog({
  alertId,
  instance,
  onClose,
}: {
  alertId: string;
  instance: AlertInstanceSummary | null;
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
      open={instance !== null}
      onOpenChange={(open) => {
        if (!open) {
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
                  {SILENCE_DURATIONS.find((d) => d.value === hours)?.label ??
                    `${hours} hours`}
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
