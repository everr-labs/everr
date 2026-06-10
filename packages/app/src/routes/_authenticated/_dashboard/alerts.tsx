import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Skeleton } from "@everr/ui/components/skeleton";
import { Textarea } from "@everr/ui/components/textarea";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BellOff, CircleStop, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  type AlertDetail,
  type AlertSummary,
  cancelSilence,
  createSilence,
  deactivateAlert,
  getAlert,
  getAlertSettings,
  listAlertEvents,
  listAlerts,
  updateAlertSettings,
} from "@/data/alerts/server";

const SearchSchema = z.object({
  alertId: z.string().optional(),
});

const alertsQueryOptions = () =>
  queryOptions({
    queryKey: ["alerts"],
    queryFn: () => listAlerts(),
  });

const alertDetailQueryOptions = (alertId: string) =>
  queryOptions({
    queryKey: ["alerts", alertId],
    queryFn: () => getAlert({ data: { alertId } }),
  });

const alertEventsQueryOptions = (alertId: string) =>
  queryOptions({
    queryKey: ["alerts", alertId, "events"],
    queryFn: () => listAlertEvents({ data: { alertId, limit: 50 } }),
  });

const alertSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["alerts", "settings"],
    queryFn: () => getAlertSettings(),
  });

export const Route = createFileRoute("/_authenticated/_dashboard/alerts")({
  staticData: { breadcrumb: "Alerts", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Alerts" }] }),
  validateSearch: SearchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context: { queryClient }, deps }) => {
    await Promise.all([
      queryClient.prefetchQuery(alertsQueryOptions()),
      queryClient.prefetchQuery(alertSettingsQueryOptions()),
      deps.alertId
        ? queryClient.prefetchQuery(alertDetailQueryOptions(deps.alertId))
        : Promise.resolve(),
      deps.alertId
        ? queryClient.prefetchQuery(alertEventsQueryOptions(deps.alertId))
        : Promise.resolve(),
    ]);
  },
  component: AlertsPage,
});

function formatDate(value: Date | string | null) {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatInterval(seconds: number) {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function stateVariant(state: AlertSummary["currentState"]) {
  if (state === "firing") return "destructive" as const;
  if (state === "resolved") return "secondary" as const;
  return "outline" as const;
}

function splitList(value: string) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function AlertsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const alerts = useQuery(alertsQueryOptions());
  const selectedAlertId = search.alertId ?? alerts.data?.[0]?.id;

  const selectedAlert = useQuery({
    ...alertDetailQueryOptions(selectedAlertId ?? ""),
    enabled: Boolean(selectedAlertId),
  });
  const events = useQuery({
    ...alertEventsQueryOptions(selectedAlertId ?? ""),
    enabled: Boolean(selectedAlertId),
  });

  const columns = useMemo<Column<AlertSummary>[]>(
    () => [
      {
        header: "Slug",
        cell: (row) => (
          <Button
            variant="link"
            className="h-auto justify-start px-0 font-mono"
            onClick={() =>
              navigate({
                search: (prev) => ({ ...prev, alertId: row.id }),
                replace: true,
              })
            }
          >
            {row.slug}
          </Button>
        ),
      },
      { header: "Repo", cell: (row) => row.repoid },
      {
        header: "State",
        cell: (row) => (
          <div className="flex items-center gap-2">
            <Badge variant={stateVariant(row.currentState)}>
              {row.currentState}
            </Badge>
            {!row.active && <Badge variant="outline">inactive</Badge>}
            {row.activeSilence && <Badge variant="secondary">silenced</Badge>}
          </div>
        ),
      },
      { header: "Last eval", cell: (row) => formatDate(row.lastEvaluatedAt) },
      {
        header: "Interval",
        cell: (row) => formatInterval(row.evaluationIntervalSeconds),
      },
      { header: "Window", cell: (row) => row.window },
      {
        header: "Source",
        cell: (row) =>
          row.sourceLink ? (
            <a className="underline" href={row.sourceLink}>
              source
            </a>
          ) : (
            row.configFilePath || "-"
          ),
      },
    ],
    [navigate],
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Alerts</h1>
        <p className="text-muted-foreground">
          Active organization alert definitions, evidence, delivery settings,
          and event history.
        </p>
      </div>

      <Card inset="flush-content">
        <CardHeader>
          <CardTitle>Definitions</CardTitle>
          <CardDescription>
            Select an alert to inspect its current state and controls.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {alerts.isPending ? (
            <div className="flex flex-col gap-2 px-3 py-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              data={alerts.data ?? []}
              columns={columns}
              rowKey={(row) => row.id}
              emptyState={
                <div className="px-3 py-8 text-center text-muted-foreground">
                  No alerts have been applied for this organization.
                </div>
              }
            />
          )}
        </CardContent>
      </Card>

      {selectedAlertId && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <AlertDetailPanel
            alert={selectedAlert.data}
            isPending={selectedAlert.isPending}
            events={events.data ?? []}
            eventsPending={events.isPending}
          />
          <div className="flex flex-col gap-4">
            <SilenceCard alert={selectedAlert.data} />
            <SettingsCard />
          </div>
        </div>
      )}
    </div>
  );
}

function AlertDetailPanel({
  alert,
  isPending,
  events,
  eventsPending,
}: {
  alert: AlertDetail | undefined;
  isPending: boolean;
  events: Awaited<ReturnType<typeof listAlertEvents>>;
  eventsPending: boolean;
}) {
  const queryClient = useQueryClient();
  const deactivate = useMutation({
    mutationFn: (alertId: string) => deactivateAlert({ data: { alertId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  if (isPending || !alert) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Alert detail</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="font-mono">{alert.slug}</span>
          <Badge variant={stateVariant(alert.currentState)}>
            {alert.currentState}
          </Badge>
        </CardTitle>
        <CardDescription>{alert.repoid}</CardDescription>
        <CardAction>
          <Button
            variant="destructive"
            size="sm"
            disabled={!alert.active || deactivate.isPending}
            onClick={() => deactivate.mutate(alert.id)}
          >
            <CircleStop data-icon="inline-start" />
            Deactivate
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Evidence</h2>
            <div className="rounded-md border bg-muted/30 p-3">
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <dt className="text-muted-foreground">Rows</dt>
                <dd>{alert.lastRowCount}</dd>
                <dt className="text-muted-foreground">Last evaluated</dt>
                <dd>{formatDate(alert.lastEvaluatedAt)}</dd>
                <dt className="text-muted-foreground">Last fired</dt>
                <dd>{formatDate(alert.lastFiredAt)}</dd>
                <dt className="text-muted-foreground">Last resolved</dt>
                <dd>{formatDate(alert.lastResolvedAt)}</dd>
              </dl>
              <pre className="mt-3 max-h-72 overflow-auto rounded bg-background p-2 text-xs">
                {JSON.stringify(alert.lastEvidenceSnapshot, null, 2)}
              </pre>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Definition</h2>
            <div className="rounded-md border bg-muted/30 p-3">
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <dt className="text-muted-foreground">Interval</dt>
                <dd>{formatInterval(alert.evaluationIntervalSeconds)}</dd>
                <dt className="text-muted-foreground">Window</dt>
                <dd>{alert.window}</dd>
                <dt className="text-muted-foreground">Validation</dt>
                <dd>{alert.validationStatus}</dd>
                <dt className="text-muted-foreground">Last status</dt>
                <dd>{alert.lastEvaluationStatus || "-"}</dd>
              </dl>
              {alert.lastEvaluationError && (
                <pre className="mt-3 max-h-32 overflow-auto rounded bg-background p-2 text-xs text-destructive">
                  {alert.lastEvaluationError}
                </pre>
              )}
              <pre className="mt-3 max-h-72 overflow-auto rounded bg-background p-2 text-xs">
                {alert.parsedQuery}
              </pre>
            </div>
          </section>
        </div>

        <section className="mt-4 flex flex-col gap-2">
          <h2 className="text-sm font-medium">History</h2>
          {eventsPending ? (
            <Skeleton className="h-36 w-full" />
          ) : (
            <DataTable
              data={events}
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
                {
                  header: "Evidence",
                  cell: (row) => (
                    <pre className="max-h-20 max-w-md overflow-auto text-xs">
                      {row.evidenceJson}
                    </pre>
                  ),
                },
              ]}
              rowKey={(row) => row.eventId}
              emptyState={
                <div className="py-6 text-center text-muted-foreground">
                  No alert events yet.
                </div>
              }
            />
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function SilenceCard({ alert }: { alert: AlertDetail | undefined }) {
  const queryClient = useQueryClient();
  const [hours, setHours] = useState("2");
  const [reason, setReason] = useState("");
  const create = useMutation({
    mutationFn: () => {
      if (!alert) throw new Error("No alert selected");
      const parsedHours = Number(hours);
      const endsAt = new Date(
        Date.now() + Math.max(parsedHours || 1, 1) * 60 * 60 * 1000,
      ).toISOString();
      return createSilence({ data: { alertId: alert.id, endsAt, reason } });
    },
    onSuccess: async () => {
      setReason("");
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
  const cancel = useMutation({
    mutationFn: (silenceId: string) => cancelSilence({ data: { silenceId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Silence</CardTitle>
        <CardDescription>Pause notifications for this alert.</CardDescription>
      </CardHeader>
      <CardContent>
        {alert?.activeSilence ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-sm font-medium">
                Until {formatDate(alert.activeSilence.endsAt)}
              </p>
              <p className="text-muted-foreground">
                {alert.activeSilence.reason || "No reason provided"}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(alert.activeSilence?.id ?? "")}
            >
              <X data-icon="inline-start" />
              Cancel silence
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
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
            <Button
              disabled={!alert || create.isPending}
              onClick={() => create.mutate()}
            >
              <BellOff data-icon="inline-start" />
              Create silence
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SettingsCard() {
  const queryClient = useQueryClient();
  const settings = useQuery(alertSettingsQueryOptions());
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramChatIds, setTelegramChatIds] = useState("");
  const [notifyOnResolved, setNotifyOnResolved] = useState(true);

  useEffect(() => {
    const delivery = settings.data?.delivery;
    if (!delivery) return;
    setEmailEnabled(delivery.email.enabled);
    setEmailTo(delivery.email.to.join("\n"));
    setTelegramEnabled(delivery.telegram.enabled);
    setTelegramChatIds(delivery.telegram.chatIds.join("\n"));
    setNotifyOnResolved(delivery.notifyOnResolved);
  }, [settings.data]);

  const update = useMutation({
    mutationFn: () =>
      updateAlertSettings({
        data: {
          delivery: {
            email: { enabled: emailEnabled, to: splitList(emailTo) },
            telegram: {
              enabled: telegramEnabled,
              chatIds: splitList(telegramChatIds),
            },
            notifyOnResolved,
          },
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts", "settings"] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery Settings</CardTitle>
        <CardDescription>
          Organization-level notification defaults.
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            disabled={settings.isFetching}
            onClick={() => void settings.refetch()}
          >
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={emailEnabled}
              onChange={(event) => setEmailEnabled(event.target.checked)}
            />
            Email
          </label>
          <Textarea
            aria-label="Email recipients"
            placeholder="team@example.com"
            value={emailTo}
            onChange={(event) => setEmailTo(event.target.value)}
          />

          <label className="flex items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={telegramEnabled}
              onChange={(event) => setTelegramEnabled(event.target.checked)}
            />
            Telegram
          </label>
          <Textarea
            aria-label="Telegram chat IDs"
            placeholder="-1001234567890"
            value={telegramChatIds}
            onChange={(event) => setTelegramChatIds(event.target.value)}
          />

          <label className="flex items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={notifyOnResolved}
              onChange={(event) => setNotifyOnResolved(event.target.checked)}
            />
            Notify when resolved
          </label>

          {update.error && (
            <p className="text-destructive" role="alert">
              {update.error.message}
            </p>
          )}
          <Button disabled={update.isPending} onClick={() => update.mutate()}>
            Save settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
