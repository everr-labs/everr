import { Button } from "@everr/ui/components/button";
import { Card, CardContent } from "@everr/ui/components/card";
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
import { Skeleton } from "@everr/ui/components/skeleton";
import { Switch } from "@everr/ui/components/switch";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useMemo, useState } from "react";
import type { NormalizedAlertDeliverySettings } from "@/data/alerts/delivery-settings";
import {
  validateSlackWebhookUrl,
  validateTelegramChatId,
} from "@/data/alerts/recipients";
import {
  type AlertSummary,
  getAlertSettings,
  listAlerts,
  updateAlertSettings,
} from "@/data/alerts/server";
import {
  AlertStateBadges,
  formatInterval,
  isEvaluationStale,
  QueryErrorMessage,
  RelativeTime,
} from "./-alerts-shared";

const alertsQueryOptions = () =>
  queryOptions({ queryKey: ["alerts"], queryFn: () => listAlerts() });

const alertSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ["alerts", "settings"],
    queryFn: () => getAlertSettings(),
  });

export const Route = createFileRoute("/_authenticated/_dashboard/alerts")({
  staticData: { breadcrumb: "Alerts", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Alerts" }] }),
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([
      queryClient.prefetchQuery(alertsQueryOptions()),
      queryClient.prefetchQuery(alertSettingsQueryOptions()),
    ]);
  },
  component: AlertsPage,
});

function AlertsPage() {
  const alerts = useQuery(alertsQueryOptions());
  const settings = useQuery(alertSettingsQueryOptions());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const summary = useMemo(() => {
    let firing = 0;
    let errored = 0;
    let ok = 0;
    let inactive = 0;
    for (const a of alerts.data ?? []) {
      if (!a.active) inactive += 1;
      else if (a.lastEvaluationStatus === "error") errored += 1;
      else if (a.currentState === "firing") firing += 1;
      else ok += 1;
    }
    return { firing, errored, ok, inactive };
  }, [alerts.data]);

  const delivery = settings.data?.delivery;
  const hasChannel =
    !!delivery &&
    ((delivery.telegram.enabled && delivery.telegram.entries.length > 0) ||
      (delivery.slack.enabled && delivery.slack.webhooks.length > 0));

  const columns = useMemo<Column<AlertSummary>[]>(
    () => [
      {
        header: "Alert",
        cell: (row) => (
          <Link
            to="/alerts/$alertId"
            params={{ alertId: row.id }}
            className="block underline-offset-4 hover:underline"
          >
            {row.displayName ? (
              <span className="flex items-baseline gap-2">
                <span className="font-medium">{row.displayName}</span>
                <span className="font-mono text-muted-foreground text-xs">
                  {row.slug}
                </span>
              </span>
            ) : (
              <span className="font-mono">{row.slug}</span>
            )}
          </Link>
        ),
      },
      {
        header: "State",
        cell: (row) => (
          <AlertStateBadges
            state={row.currentState}
            active={row.active}
            firingInstanceCount={row.firingInstanceCount}
            silenced={
              row.currentState === "firing" && row.activeSilenceCount > 0
            }
          />
        ),
      },
      {
        header: "Last eval",
        cell: (row) => {
          const stale = isEvaluationStale(
            row.lastEvaluatedAt,
            row.evaluationIntervalSeconds,
          );
          return (
            <span
              className={stale ? "text-amber-500" : undefined}
              title={
                stale
                  ? "Evaluation overdue — this rule hasn't run recently"
                  : undefined
              }
            >
              <RelativeTime value={row.lastEvaluatedAt} />
            </span>
          );
        },
      },
      {
        header: "Firing since",
        cell: (row) =>
          row.currentState === "firing" ? (
            <RelativeTime value={row.lastFiredAt} />
          ) : (
            "—"
          ),
      },
      {
        header: "Interval",
        cell: (row) => formatInterval(row.evaluationIntervalSeconds),
      },
    ],
    [],
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Alerts</h1>
          <p className="text-muted-foreground">
            Alert rules applied for this organization.
          </p>
        </div>
        <Button variant="outline" onClick={() => setSettingsOpen(true)}>
          <Settings data-icon="inline-start" />
          Notification settings
        </Button>
      </div>

      {settings.data && !hasChannel && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          No notification channels are configured, so firing alerts won't reach
          anyone.{" "}
          <button
            type="button"
            className="font-medium underline underline-offset-4"
            onClick={() => setSettingsOpen(true)}
          >
            Configure notifications
          </button>
          .
        </div>
      )}

      {alerts.data && alerts.data.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-muted-foreground text-sm">
          <span>
            <span
              className={`font-semibold ${summary.firing > 0 ? "text-destructive" : "text-foreground"}`}
            >
              {summary.firing}
            </span>{" "}
            firing
          </span>
          <span>
            <span
              className={`font-semibold ${summary.errored > 0 ? "text-amber-500" : "text-foreground"}`}
            >
              {summary.errored}
            </span>{" "}
            errored
          </span>
          <span>
            <span className="font-semibold text-foreground">{summary.ok}</span>{" "}
            ok
          </span>
          <span>
            <span className="font-semibold text-foreground">
              {summary.inactive}
            </span>{" "}
            inactive
          </span>
        </div>
      )}

      <Card inset="flush-content">
        <CardContent>
          {alerts.isError ? (
            <QueryErrorMessage message="Unable to load alerts." />
          ) : alerts.isPending ? (
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
                  <p>No alerts have been applied for this organization.</p>
                  <p className="mt-1">
                    <a
                      className="underline underline-offset-4"
                      href="https://everr.dev/docs/alerts/first-alert"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Create your first alert
                    </a>
                  </p>
                </div>
              }
            />
          )}
        </CardContent>
      </Card>

      <NotificationSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </div>
  );
}

function NotificationSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useQuery(alertSettingsQueryOptions());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notification settings</DialogTitle>
          <DialogDescription>
            Organization-level delivery for alert notifications.{" "}
            <a
              className="underline underline-offset-4"
              href="https://everr.dev/docs/alerts/notifications"
              target="_blank"
              rel="noreferrer"
            >
              Learn more
            </a>
            .
          </DialogDescription>
        </DialogHeader>
        {settings.isError ? (
          <p className="text-destructive text-sm" role="alert">
            Unable to load notification settings.
          </p>
        ) : settings.data ? (
          // Mounted fresh on every dialog open (the popup unmounts on close),
          // so the form reads its defaults once — no effect syncing state.
          <NotificationSettingsForm
            initial={settings.data.delivery}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <Skeleton className="h-48 w-full" />
        )}
      </DialogContent>
    </Dialog>
  );
}

type TelegramRow =
  | { kind: "existing"; id: string; name?: string; chatId: string }
  | { kind: "new"; name: string; botToken: string; chatId: string };
type SlackRow =
  | { kind: "existing"; id: string; name?: string }
  | { kind: "new"; name: string; url: string };

function toTelegramRows(
  initial: NormalizedAlertDeliverySettings,
): TelegramRow[] {
  return initial.telegram.entries.map((e) => ({
    kind: "existing",
    id: e.id,
    name: e.name,
    chatId: e.chatId,
  }));
}
function toSlackRows(initial: NormalizedAlertDeliverySettings): SlackRow[] {
  return initial.slack.webhooks.map((w) => ({
    kind: "existing",
    id: w.id,
    name: w.name,
  }));
}

function NotificationSettingsForm({
  initial,
  onClose,
}: {
  initial: NormalizedAlertDeliverySettings;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [telegramEnabled, setTelegramEnabled] = useState(
    initial.telegram.enabled,
  );
  const [slackEnabled, setSlackEnabled] = useState(initial.slack.enabled);
  const [telegramRows, setTelegramRows] = useState<TelegramRow[]>(() =>
    toTelegramRows(initial),
  );
  const [slackRows, setSlackRows] = useState<SlackRow[]>(() =>
    toSlackRows(initial),
  );

  const update = useMutation({
    mutationFn: () =>
      updateAlertSettings({
        data: {
          delivery: {
            telegram: {
              enabled: telegramEnabled,
              entries: telegramRows.map((r) =>
                r.kind === "existing"
                  ? { id: r.id }
                  : {
                      name: r.name || undefined,
                      botToken: r.botToken,
                      chatId: r.chatId,
                    },
              ),
            },
            slack: {
              enabled: slackEnabled,
              webhooks: slackRows.map((r) =>
                r.kind === "existing"
                  ? { id: r.id }
                  : { name: r.name || undefined, url: r.url },
              ),
            },
          },
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts", "settings"] });
      onClose();
    },
  });

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate();
      }}
    >
      <TelegramChannel
        enabled={telegramEnabled}
        onEnabledChange={setTelegramEnabled}
        rows={telegramRows}
        onRowsChange={setTelegramRows}
      />
      <SlackChannel
        enabled={slackEnabled}
        onEnabledChange={setSlackEnabled}
        rows={slackRows}
        onRowsChange={setSlackRows}
      />
      {update.error && (
        <p className="text-destructive text-sm" role="alert">
          {update.error.message}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={update.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={update.isPending}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function TelegramChannel({
  enabled,
  onEnabledChange,
  rows,
  onRowsChange,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  rows: TelegramRow[];
  onRowsChange: (rows: TelegramRow[]) => void;
}) {
  const [name, setName] = useState("");
  const [chatId, setChatId] = useState("");
  const [botToken, setBotToken] = useState("");
  const chatIdError = chatId ? validateTelegramChatId(chatId) : null;
  const canAdd =
    enabled && !chatIdError && chatId.length > 0 && botToken.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <Label className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        Telegram
      </Label>
      {enabled && (
        <>
          <ul className="flex flex-col gap-1">
            {rows.map((row, i) => (
              <li
                key={row.kind === "existing" ? row.id : `new-${i}`}
                className="flex items-center justify-between rounded border px-2 py-1 text-sm"
              >
                <span>
                  {row.name ? `${row.name} · ` : ""}
                  {row.chatId}
                  {row.kind === "existing" ? " · token configured" : ""}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRowsChange(rows.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1">
            <Input
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              placeholder="Chat ID (e.g. -1001234567890)"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              aria-invalid={!!chatIdError}
            />
            <Input
              type="password"
              autoComplete="off"
              placeholder="Bot token"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
            />
            {chatIdError && (
              <p className="text-destructive text-xs" role="alert">
                {chatIdError}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canAdd}
              onClick={() => {
                onRowsChange([
                  ...rows,
                  { kind: "new", name, botToken, chatId },
                ]);
                setName("");
                setChatId("");
                setBotToken("");
              }}
            >
              Add Telegram chat
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function SlackChannel({
  enabled,
  onEnabledChange,
  rows,
  onRowsChange,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  rows: SlackRow[];
  onRowsChange: (rows: SlackRow[]) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const urlError = url ? validateSlackWebhookUrl(url) : null;
  const canAdd = enabled && !urlError && url.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <Label className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        Slack
      </Label>
      {enabled && (
        <>
          <ul className="flex flex-col gap-1">
            {rows.map((row, i) => (
              <li
                key={row.kind === "existing" ? row.id : `new-${i}`}
                className="flex items-center justify-between rounded border px-2 py-1 text-sm"
              >
                <span>
                  {row.name || "Webhook"}
                  {row.kind === "existing" ? " · configured" : " · new"}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRowsChange(rows.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1">
            <Input
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              type="password"
              autoComplete="off"
              placeholder="https://hooks.slack.com/services/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={!!urlError}
            />
            {urlError && (
              <p className="text-destructive text-xs" role="alert">
                {urlError}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canAdd}
              onClick={() => {
                onRowsChange([...rows, { kind: "new", name, url }]);
                setName("");
                setUrl("");
              }}
            >
              Add Slack webhook
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
