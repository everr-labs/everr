import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@everr/ui/components/card";
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
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BellOff, CircleCheck, CirclePlay, CircleStop, NotebookText, Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ALERT_CHANNELS, type AlertDeliveryTargets } from "@/data/alerts/delivery-settings";
import { type Matcher, NO_LABELS_TEXT, sortedLabelEntries } from "@/data/alerts/matchers";
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
} from "@/data/alerts/server";
import { useTimeRange } from "@/hooks/use-time-range";
import {
  formatDate,
  formatInterval,
  QueryErrorMessage,
  RelativeTime,
  stateVariant,
  TimeUntil,
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

export const Route = createFileRoute("/_authenticated/_dashboard/_previewable/alerts_/$alertId")({
  staticData: {
    breadcrumb: (match: { loaderData?: { slug?: string } }) => [
      { label: "Alerts", to: "/alerts" },
      { label: match.loaderData?.slug ?? "Alert" },
    ],
  },
  head: () => ({ meta: [{ title: "Everr - Alert detail" }] }),
  loaderDeps: ({ search }) => withTimeRange(search),
  loader: async ({ context: { queryClient }, params, deps }) => {
    const detail = await queryClient.ensureQueryData(alertDetailQueryOptions(params.alertId));

    if (!detail) return {};

    await Promise.all([
      queryClient.prefetchQuery(alertInstancesQueryOptions(params.alertId, deps.timeRange)),
      queryClient.prefetchQuery(alertSilencesQueryOptions(params.alertId)),
      queryClient.prefetchQuery(alertEventsQueryOptions(params.alertId, deps.timeRange)),
    ]);

    return { slug: detail.slug };
  },
  component: AlertDetailPage,
});

// What SilenceDialog needs to prefill matchers: an instance's fingerprint and
// labels. Both the firing-instances row and a history event can produce one.
type SilenceTarget = {
  fingerprint: string;
  labels: Record<string, string>;
};

function AlertNotFound() {
  return (
    <div className="flex flex-col items-start gap-4">
      <p className="text-muted-foreground" role="alert">
        Alert not found.
      </p>
      <Link to="/alerts" className="underline underline-offset-4">
        Back to alerts
      </Link>
    </div>
  );
}

function AlertDetailPage() {
  const { alertId } = Route.useParams();
  const queryClient = useQueryClient();
  const { timeRange } = useTimeRange();
  const alert = useQuery(alertDetailQueryOptions(alertId));
  const hasAlert = Boolean(alert.data);
  const instances = useQuery({
    ...alertInstancesQueryOptions(alertId, timeRange),
    enabled: hasAlert,
  });
  const silences = useQuery({
    ...alertSilencesQueryOptions(alertId),
    enabled: hasAlert,
  });
  const events = useQuery({
    ...alertEventsQueryOptions(alertId, timeRange),
    enabled: hasAlert,
  });
  const [silenceTarget, setSilenceTarget] = useState<SilenceTarget | null>(null);
  const [newSilenceOpen, setNewSilenceOpen] = useState(false);

  const setActive = useMutation({
    mutationFn: (active: boolean) =>
      active ? activateAlert({ data: { alertId } }) : deactivateAlert({ data: { alertId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  if (alert.isPending) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (alert.isError) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-muted-foreground" role="alert">
          Unable to load alert.
        </p>
        <Link to="/alerts" className="underline underline-offset-4">
          Back to alerts
        </Link>
      </div>
    );
  }
  if (!alert.data) {
    return <AlertNotFound />;
  }
  const detail = alert.data;
  const definitionRows: [string, ReactNode][] = [
    ["Repository", detail.repoid],
    ["Project", detail.project],
    ...maybeRow(detail.runbookSlug, [
      "Runbook",
      runbookLink(detail.runbookProject, detail.runbookSlug),
    ]),
    ["Evaluation interval", formatInterval(detail.evaluationIntervalSeconds)],
    ["Notification title", detail.notificationTitleTemplate],
    ["Notification description", detail.notificationDescriptionTemplate || "-"],
    ...maybeRow(detail.instanceLabelColumns.length > 0, [
      "Instance labels",
      detail.instanceLabelColumns.join(", "),
    ]),
    ["Last evaluated", formatDate(detail.lastEvaluatedAt)],
  ];

  const firingInstances = (instances.data ?? []).filter((row) => row.state === "firing");
  const showFiringSuccess = instances.isSuccess && firingInstances.length === 0;
  const silenceCount = silences.data?.length ?? 0;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-mono text-xl font-bold tracking-tight break-words">
            {detail.display.name || detail.slug}
          </h1>
          {detail.display.description && (
            <p className="max-w-3xl text-muted-foreground">{detail.display.description}</p>
          )}
          {setActive.error && (
            <p className="text-sm text-destructive" role="alert">
              Couldn't update evaluation. {setActive.error.message}
            </p>
          )}
        </div>
        {detail.active ? (
          <Button
            variant="destructive"
            size="sm"
            className="shrink-0"
            disabled={setActive.isPending}
            onClick={() => setActive.mutate(false)}
          >
            <CircleStop data-icon="inline-start" />
            Pause evaluation
          </Button>
        ) : (
          <Button
            size="sm"
            className="shrink-0"
            disabled={setActive.isPending}
            onClick={() => setActive.mutate(true)}
          >
            <CirclePlay data-icon="inline-start" />
            Resume evaluation
          </Button>
        )}
      </div>

      {showFiringSuccess ? (
        <Card className="border-emerald-500/30 bg-emerald-500/5 py-3">
          <CardContent className="flex items-center gap-3">
            <CircleCheck className="size-5 shrink-0 text-emerald-500" />
            <p className="text-sm">
              <span className="font-medium text-foreground">You're all good.</span>{" "}
              <span className="text-muted-foreground">Nothing's firing right now.</span>
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
                rowClassName={(row) => (row.silenced ? "opacity-50" : undefined)}
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
                          {row.silenced && <Badge variant="secondary">silenced</Badge>}
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
                    {
                      header: "",
                      cell: (row) => (
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
                          <span className="hidden md:inline">Silence</span>
                        </Button>
                      ),
                    },
                  ] satisfies Column<AlertInstanceSummary>[]
                }
                rowKey={(row) => row.fingerprint}
              />
            )}
          </CardContent>
        </Card>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Definition</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <DefinitionTable rows={definitionRows} />
              {detail.lastEvaluationError && (
                <pre className="max-h-32 overflow-auto rounded bg-muted/30 p-2 text-xs text-destructive">
                  {detail.lastEvaluationError}
                </pre>
              )}

              <div className="flex flex-col gap-1.5">
                <span className="font-medium text-muted-foreground text-xs">Query</span>
                <pre className="max-h-72 overflow-auto rounded-md border border-border/60 bg-muted/20 p-3 text-xs leading-relaxed">
                  {detail.parsedQuery}
                </pre>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              Silences
              {silenceCount > 0 && (
                <span className="font-normal text-muted-foreground text-xs">
                  {silenceCount} active
                </span>
              )}
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => {
                setSilenceTarget(null);
                setNewSilenceOpen(true);
              }}
            >
              <Plus data-icon="inline-start" />
              Add
            </Button>
          </CardHeader>
          <CardContent>
            {silences.isError ? (
              <QueryErrorMessage message="Unable to load silences." />
            ) : silences.isPending ? (
              <Skeleton className="h-20 w-full" />
            ) : silenceCount > 0 ? (
              <div className="divide-y divide-border/60">
                {silences.data?.map((silence) => (
                  <SilenceRow key={silence.id} silence={silence} />
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border/70 px-3 py-3 text-muted-foreground text-xs">
                No active silences.
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
                  cell: (row) => <HistoryInstanceState instances={row.instances} />,
                },
                {
                  header: "Instance",
                  cell: (row) => <HistoryInstances instances={row.instances} />,
                },
                {
                  header: "Delivery",
                  cell: (row) => formatDeliveryTargets(row),
                },
                {
                  header: "",
                  cell: (row) => {
                    const instance =
                      row.instances.find((i) => i.state === "firing") ?? row.instances[0];
                    return (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label="Silence"
                        onClick={() => {
                          setSilenceTarget({
                            fingerprint: row.eventId,
                            labels: instance?.labels ?? {},
                          });
                          setNewSilenceOpen(false);
                        }}
                      >
                        <BellOff data-icon="inline-start" />
                        <span className="hidden md:inline">Silence</span>
                      </Button>
                    );
                  },
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
        open={newSilenceOpen}
        onClose={() => {
          setSilenceTarget(null);
          setNewSilenceOpen(false);
        }}
      />
    </div>
  );
}

function LastEvaluationResult({ instance }: { instance: AlertInstanceSummary }) {
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

function maybeRow(test: unknown, row: [string, ReactNode]): Array<[string, ReactNode]> {
  return test ? [row] : [];
}

function DefinitionTable({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid text-xs">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 border-border/50 border-b py-1.5 last:border-b-0"
        >
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function nonLabelValues(row: Record<string, unknown>, labels: Record<string, string>) {
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

function formatDeliveryTargets(row: { deliveryTargets: AlertDeliveryTargets; silenceId: string }) {
  if (row.silenceId) return "silenced";
  const targets = ALERT_CHANNELS.filter((target) => (row.deliveryTargets[target]?.length ?? 0) > 0);
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

function HistoryInstanceState({ instances }: { instances: { state: "firing" | "resolved" }[] }) {
  const states = Array.from(new Set(instances.map((instance) => instance.state)));
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
  const matcherText =
    silence.matchers.length === 0
      ? "All instances"
      : silence.matchers.map((m) => `${m.label}${m.op}${m.value}`).join(", ");
  return (
    <div className="py-2.5">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          <span
            className={
              silence.matchers.length === 0
                ? "font-medium text-foreground"
                : "font-mono text-foreground"
            }
          >
            {matcherText}
          </span>
          <span className="text-muted-foreground">
            expires <TimeUntil value={silence.endsAt} />
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 cursor-pointer text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Cancel silence"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          <X className="size-3" />
        </Button>
      </div>
      {silence.reason && (
        <span className="mt-1 block text-muted-foreground text-xs">{silence.reason}</span>
      )}
      {cancel.error && (
        <span className="mt-1.5 block text-destructive text-xs" role="alert">
          Couldn't cancel silence. {cancel.error.message}
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
  const [wasOpen, setWasOpen] = useState(false);

  const isOpen = instance !== null || (open ?? false);
  // Re-seed the form on each open transition (not via a prop→state effect): a
  // specific instance prefills its labels as matchers; the blank "Add" form
  // (instance === null) resets to empty so it can't inherit the matchers of the
  // instance silenced just before it.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setMatchers(
        instance
          ? Object.entries(instance.labels).map(([label, value]) => ({
              label,
              op: "=" as const,
              value,
            }))
          : [],
      );
      setHours("2");
      setReason("");
    }
  }

  const patchMatcher = (index: number, patch: Partial<Matcher>) =>
    setMatchers((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));

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
    },
  });

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(dialogOpen) => {
        if (!dialogOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Silence instances</DialogTitle>
          <DialogDescription>
            Notifications are paused for instances matching all matchers. Evaluation continues.
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
              <div key={index} className="grid grid-cols-[1fr_72px_1fr_28px] items-center gap-1.5">
                <Input
                  aria-label="Label"
                  placeholder="label"
                  className="font-mono"
                  value={matcher.label}
                  onChange={(event) => patchMatcher(index, { label: event.target.value })}
                />
                <Select
                  value={matcher.op}
                  onValueChange={(op) => {
                    const matched = MATCHER_OPS.find((o) => o === op);
                    if (matched) patchMatcher(index, { op: matched });
                  }}
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
                  onChange={(event) => patchMatcher(index, { value: event.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove matcher"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setMatchers((prev) => prev.filter((_, i) => i !== index))}
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setMatchers((prev) => [...prev, { label: "", op: "=", value: "" }])}
            >
              <Plus data-icon="inline-start" />
              Add matcher
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="silence-duration">Duration</Label>
            <Select value={hours} onValueChange={(value) => value && setHours(value)}>
              <SelectTrigger id="silence-duration" className="w-full">
                <SelectValue>{SILENCE_DURATIONS.find((d) => d.value === hours)?.label}</SelectValue>
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
              Reason <span className="font-normal text-muted-foreground">(optional)</span>
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
              Couldn't create silence. {create.error.message}
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
