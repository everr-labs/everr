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
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BellOff, CircleStop, Plus, X } from "lucide-react";
import { useState } from "react";
import { formatLabels, type Matcher } from "@/data/alerts/matchers";
import {
  type AlertInstanceSummary,
  type AlertSilenceSummary,
  cancelSilence,
  createSilence,
  deactivateAlert,
  getAlert,
  listAlertEvents,
  listAlertInstances,
  listAlertSilences,
} from "@/data/alerts/server";
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

const alertInstancesQueryOptions = (alertId: string) =>
  queryOptions({
    queryKey: ["alerts", alertId, "instances"],
    queryFn: () => listAlertInstances({ data: { alertId } }),
  });

const alertSilencesQueryOptions = (alertId: string) =>
  queryOptions({
    queryKey: ["alerts", alertId, "silences"],
    queryFn: () => listAlertSilences({ data: { alertId } }),
  });

const alertEventsQueryOptions = (alertId: string) =>
  queryOptions({
    queryKey: ["alerts", alertId, "events"],
    queryFn: () => listAlertEvents({ data: { alertId, limit: 50 } }),
  });

export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts_/$alertId",
)({
  staticData: { breadcrumb: "Alert", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Alert detail" }] }),
  loader: async ({ context: { queryClient }, params }) => {
    await Promise.all([
      queryClient.prefetchQuery(alertDetailQueryOptions(params.alertId)),
      queryClient.prefetchQuery(alertInstancesQueryOptions(params.alertId)),
      queryClient.prefetchQuery(alertSilencesQueryOptions(params.alertId)),
      queryClient.prefetchQuery(alertEventsQueryOptions(params.alertId)),
    ]);
  },
  component: AlertDetailPage,
});

function AlertDetailPage() {
  const { alertId } = Route.useParams();
  const queryClient = useQueryClient();
  const alert = useQuery(alertDetailQueryOptions(alertId));
  const instances = useQuery(alertInstancesQueryOptions(alertId));
  const silences = useQuery(alertSilencesQueryOptions(alertId));
  const events = useQuery(alertEventsQueryOptions(alertId));
  const [silenceTarget, setSilenceTarget] =
    useState<AlertInstanceSummary | null>(null);

  const deactivate = useMutation({
    mutationFn: () => deactivateAlert({ data: { alertId } }),
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
              silenced={detail.activeSilenceCount > 0}
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
        <Button
          variant="destructive"
          size="sm"
          disabled={!detail.active || deactivate.isPending}
          onClick={() => deactivate.mutate()}
        >
          <CircleStop data-icon="inline-start" />
          Deactivate
        </Button>
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
              data={instances.data ?? []}
              columns={
                [
                  {
                    header: "Labels",
                    cell: (row) => (
                      <span className="font-mono text-xs">
                        {formatLabels(row.labels)}
                      </span>
                    ),
                  },
                  {
                    header: "State",
                    cell: (row) => (
                      <div className="flex items-center gap-2">
                        <Badge variant={stateVariant(row.state)}>
                          {row.state}
                        </Badge>
                        {row.silenced && (
                          <Badge variant="secondary">silenced</Badge>
                        )}
                      </div>
                    ),
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
                        onClick={() => setSilenceTarget(row)}
                      >
                        <BellOff data-icon="inline-start" />
                        Silence
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
          <CardContent>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <dt className="text-muted-foreground">Interval</dt>
              <dd>{formatInterval(detail.evaluationIntervalSeconds)}</dd>
              <dt className="text-muted-foreground">Window</dt>
              <dd>{detail.window}</dd>
              <dt className="text-muted-foreground">Last evaluated</dt>
              <dd>{formatDate(detail.lastEvaluatedAt)}</dd>
            </dl>
            {detail.lastEvaluationError && (
              <pre className="mt-3 max-h-32 overflow-auto rounded bg-muted/30 p-2 text-xs text-destructive">
                {detail.lastEvaluationError}
              </pre>
            )}
            <pre className="mt-3 max-h-72 overflow-auto rounded bg-muted/30 p-2 text-xs">
              {detail.parsedQuery}
            </pre>
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
              data={events.data ?? []}
              columns={[
                { header: "Time", cell: (row) => formatDate(row.eventTime) },
                { header: "Type", cell: (row) => row.eventType },
                { header: "Rows", cell: (row) => row.rowCount },
                {
                  header: "Delivery",
                  cell: (row) =>
                    row.deliveryTargetType
                      ? `${row.deliveryTargetType}: ${row.deliveryOutcome || "-"}`
                      : "-",
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
    mutationFn: () => {
      const parsedHours = Number(hours);
      const endsAt = new Date(
        Date.now() + Math.max(parsedHours || 1, 1) * 60 * 60 * 1000,
      ).toISOString();
      return createSilence({ data: { alertId, endsAt, reason, matchers } });
    },
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
                className="grid grid-cols-[1fr_90px_1fr_32px] items-center gap-2"
              >
                <Input
                  aria-label="Label"
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
                  <SelectTrigger aria-label="Operator">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MATCHER_OPS.map((op) => (
                      <SelectItem key={op} value={op}>
                        {op}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label="Value"
                  value={matcher.value}
                  onChange={(event) =>
                    patchMatcher(index, { value: event.target.value })
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove matcher"
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
          <div className="grid grid-cols-[120px_1fr] items-center gap-2">
            <Label htmlFor="silence-hours">Hours</Label>
            <Input
              id="silence-hours"
              type="number"
              min="1"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="silence-reason">Reason</Label>
            <Textarea
              id="silence-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {create.error && (
            <p className="text-destructive" role="alert">
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
