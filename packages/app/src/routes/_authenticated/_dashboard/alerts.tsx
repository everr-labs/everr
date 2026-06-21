import { Badge } from "@everr/ui/components/badge";
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
import { cn } from "@everr/ui/lib/utils";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { NotebookText, SearchIcon, Settings, XIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";
import type { NormalizedAlertDeliverySettings } from "@/data/alerts/delivery-settings";
import {
  validateSlackWebhookUrl,
  validateTelegramBotToken,
  validateTelegramChatId,
} from "@/data/alerts/recipients";
import { formatNotebookRef } from "@/data/alerts/schema";
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

type AlertListFilter =
  | "all"
  | "firing"
  | "errored"
  | "silenced"
  | "resolved"
  | "unknown"
  | "inactive";

interface AlertFilterOption {
  value: AlertListFilter;
  label: string;
  count: number;
  tone?: "destructive" | "warning";
}

function alertMatchesFilter(alert: AlertSummary, filter: AlertListFilter) {
  switch (filter) {
    case "all":
      return true;
    case "firing":
      return alert.active && alert.currentState === "firing";
    case "errored":
      return alert.active && alert.lastEvaluationStatus === "error";
    case "silenced":
      return alert.activeSilenceCount > 0;
    case "resolved":
      return alert.active && alert.currentState === "resolved";
    case "unknown":
      return alert.active && alert.currentState === "unknown";
    case "inactive":
      return !alert.active;
  }
}

function alertMatchesSearch(alert: AlertSummary, query: string) {
  if (!query) return true;
  return [
    alert.displayName,
    alert.slug,
    alert.project,
    alert.repoid,
    alert.configFilePath,
    alert.notebookProject,
    alert.notebookSlug,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function AlertFilterButton({
  option,
  active,
  onSelect,
}: {
  option: AlertFilterOption;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "h-6 gap-1.5 rounded-md px-1.5 text-[0.6875rem] transition-colors",
        active
          ? "border-border bg-muted/70 text-foreground shadow-none hover:bg-muted"
          : "border-border/60 bg-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground",
        active &&
          option.tone === "destructive" &&
          "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15",
        active &&
          option.tone === "warning" &&
          "border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/15 dark:text-amber-400",
      )}
    >
      <span className="font-medium">{option.label}</span>
      <span
        className={cn(
          "inline-flex min-w-4 items-center justify-center rounded-sm px-1 font-semibold tabular-nums",
          active ? "bg-background/70" : "bg-muted/50 text-foreground",
          active &&
            option.tone === "destructive" &&
            "bg-destructive/15 text-destructive",
          active &&
            option.tone === "warning" &&
            "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        )}
      >
        {option.count}
      </span>
    </Button>
  );
}

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
  const [alertFilter, setAlertFilter] = useState<AlertListFilter>("all");
  const [alertSearch, setAlertSearch] = useState("");

  const summary = useMemo(() => {
    let firing = 0;
    let errored = 0;
    let resolved = 0;
    let unknown = 0;
    let inactive = 0;
    let silenced = 0;
    for (const a of alerts.data ?? []) {
      if (a.activeSilenceCount > 0) silenced += 1;
      if (!a.active) inactive += 1;
      else {
        if (a.lastEvaluationStatus === "error") errored += 1;
        if (a.currentState === "firing") firing += 1;
        else if (a.currentState === "resolved") resolved += 1;
        else unknown += 1;
      }
    }
    return {
      total: alerts.data?.length ?? 0,
      firing,
      errored,
      resolved,
      unknown,
      inactive,
      silenced,
    };
  }, [alerts.data]);

  const filterOptions = useMemo<AlertFilterOption[]>(() => {
    // "Unknown" only appears when there are unknown alerts (or it's the active
    // filter, so the selected chip stays visible); placed inline to keep the
    // chip order self-describing rather than splicing at a magic index.
    const showUnknown = summary.unknown > 0 || alertFilter === "unknown";
    return [
      { value: "all", label: "All", count: summary.total },
      {
        value: "firing",
        label: "Firing",
        count: summary.firing,
        tone: "destructive",
      },
      {
        value: "errored",
        label: "Errored",
        count: summary.errored,
        tone: "warning",
      },
      { value: "silenced", label: "Silenced", count: summary.silenced },
      { value: "resolved", label: "Resolved", count: summary.resolved },
      ...(showUnknown
        ? [
            {
              value: "unknown" as const,
              label: "Unknown",
              count: summary.unknown,
            },
          ]
        : []),
      { value: "inactive", label: "Inactive", count: summary.inactive },
    ];
  }, [alertFilter, summary]);

  const filteredAlerts = useMemo(() => {
    const query = alertSearch.trim().toLowerCase();
    return (alerts.data ?? []).filter(
      (alert) =>
        alertMatchesFilter(alert, alertFilter) &&
        alertMatchesSearch(alert, query),
    );
  }, [alertFilter, alertSearch, alerts.data]);
  const hasActiveListFilters =
    alertFilter !== "all" || alertSearch.trim().length > 0;
  const clearAlertFilters = () => {
    setAlertFilter("all");
    setAlertSearch("");
  };

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
            lastFiredAt={row.lastFiredAt}
            activeSilenceCount={row.activeSilenceCount}
            activeSilenceExpiresAt={row.activeSilenceExpiresAt}
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
            <span className="flex items-center gap-1.5">
              <span className={stale ? "text-amber-500" : undefined}>
                <RelativeTime value={row.lastEvaluatedAt} />
              </span>
              {stale && (
                <Badge
                  variant="outline"
                  className="border-amber-500/40 text-amber-500"
                  title="Evaluation overdue — this rule hasn't run recently"
                >
                  overdue
                </Badge>
              )}
            </span>
          );
        },
      },
      {
        header: "Interval",
        cell: (row) => formatInterval(row.evaluationIntervalSeconds),
      },
      {
        header: "Notebook",
        cell: (row) =>
          row.notebookSlug ? (
            <Link
              to="/notebooks/$project/$slug"
              params={{ project: row.notebookProject, slug: row.notebookSlug }}
              className="inline-flex items-center text-muted-foreground hover:text-foreground"
              title={formatNotebookRef(row.notebookProject, row.notebookSlug)}
              onClick={(e) => e.stopPropagation()}
            >
              <NotebookText className="size-4" />
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
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
        <div className="flex flex-col gap-2.5">
          <fieldset className="flex flex-wrap items-center gap-1.5">
            <legend className="sr-only">Alert summary filters</legend>
            {filterOptions.map((option) => (
              <AlertFilterButton
                key={option.value}
                option={option}
                active={alertFilter === option.value}
                onSelect={() => setAlertFilter(option.value)}
              />
            ))}
          </fieldset>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <SearchIcon className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search alerts"
                placeholder="Search alerts..."
                value={alertSearch}
                onChange={(e) => setAlertSearch(e.target.value)}
                className="h-7 rounded-lg border-border/70 bg-transparent pl-7 text-xs placeholder:text-muted-foreground/80 hover:bg-muted/20 focus-visible:bg-background"
              />
            </div>
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <span>
                {hasActiveListFilters
                  ? `Showing ${filteredAlerts.length} of ${summary.total}`
                  : `${summary.total} alert ${summary.total === 1 ? "rule" : "rules"}`}
              </span>
              {hasActiveListFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearAlertFilters}
                >
                  <XIcon data-icon="inline-start" />
                  Clear
                </Button>
              )}
            </div>
          </div>
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
              data={filteredAlerts}
              columns={columns}
              rowKey={(row) => row.id}
              emptyState={
                hasActiveListFilters ? (
                  <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-muted-foreground">
                    <p>No alerts match these filters.</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearAlertFilters}
                    >
                      <XIcon data-icon="inline-start" />
                      Clear filters
                    </Button>
                  </div>
                ) : (
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
                )
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Notification settings</DialogTitle>
          <DialogDescription>
            Choose where firing alerts are delivered for everyone in this
            organization.{" "}
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

// New entries are edited inline as rows in the same array Save reads, so typed
// input is never staged-but-unsaved: pressing Enter or Save commits exactly
// what's on screen, and empty new rows are simply ignored.
type TelegramRow =
  | { kind: "existing"; id: string; name?: string; chatId: string }
  | {
      kind: "new";
      key: string;
      name: string;
      botToken: string;
      chatId: string;
    };
type SlackRow =
  | { kind: "existing"; id: string; name?: string }
  | { kind: "new"; key: string; name: string; url: string };

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

function newTelegramRow(): TelegramRow {
  return {
    kind: "new",
    key: crypto.randomUUID(),
    name: "",
    botToken: "",
    chatId: "",
  };
}
function newSlackRow(): SlackRow {
  return { kind: "new", key: crypto.randomUUID(), name: "", url: "" };
}

// A new row with nothing typed is treated as absent: never submitted, never an
// error. Anything partially filled is a real entry that must validate.
function isBlankTelegramRow(r: TelegramRow): boolean {
  return r.kind === "new" && !r.name && !r.chatId && !r.botToken;
}
function isBlankSlackRow(r: SlackRow): boolean {
  return r.kind === "new" && !r.name && !r.url;
}

// `immediate` errors (a filled field in a bad format) surface while typing; the
// rest wait for a save attempt so a half-typed row isn't nagged. Returning this
// shape lets the row derive `showError` without re-running the validator.
type RowError = { message: string; immediate: boolean };

function telegramRowError(r: TelegramRow): RowError | null {
  if (r.kind !== "new" || isBlankTelegramRow(r)) return null;
  if (!r.chatId) return { message: "Chat ID is required", immediate: false };
  const chatIdError = validateTelegramChatId(r.chatId);
  if (chatIdError) return { message: chatIdError, immediate: true };
  const tokenError = validateTelegramBotToken(r.botToken);
  if (tokenError) return { message: tokenError, immediate: false };
  return null;
}
function slackRowError(r: SlackRow): RowError | null {
  if (r.kind !== "new" || isBlankSlackRow(r)) return null;
  if (!r.url) return { message: "Webhook URL is required", immediate: false };
  const urlError = validateSlackWebhookUrl(r.url);
  return urlError ? { message: urlError, immediate: true } : null;
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
  // Gate "channel is on but empty" messaging until the first save attempt so
  // toggling a channel on doesn't immediately flash an error.
  const [submitted, setSubmitted] = useState(false);

  // A disabled channel persists only its already-saved entries — its inline
  // editor is hidden, so in-progress rows can't be seen, validated, or fixed.
  const telegramKept = telegramEnabled
    ? telegramRows.filter((r) => !isBlankTelegramRow(r))
    : telegramRows.filter((r) => r.kind === "existing");
  const slackKept = slackEnabled
    ? slackRows.filter((r) => !isBlankSlackRow(r))
    : slackRows.filter((r) => r.kind === "existing");
  const telegramEmpty = telegramEnabled && telegramKept.length === 0;
  const slackEmpty = slackEnabled && slackKept.length === 0;
  const hasRowErrors =
    (telegramEnabled && telegramRows.some((r) => telegramRowError(r))) ||
    (slackEnabled && slackRows.some((r) => slackRowError(r)));
  const blocked = telegramEmpty || slackEmpty || hasRowErrors;

  const update = useMutation({
    mutationFn: () =>
      updateAlertSettings({
        data: {
          delivery: {
            telegram: {
              enabled: telegramEnabled,
              entries: telegramKept.map((r) =>
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
              webhooks: slackKept.map((r) =>
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
      toast.success("Notification settings saved");
      onClose();
    },
  });

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (blocked || update.isPending) return;
        update.mutate();
      }}
    >
      <TelegramChannel
        enabled={telegramEnabled}
        onEnabledChange={setTelegramEnabled}
        rows={telegramRows}
        onRowsChange={setTelegramRows}
        submitted={submitted}
        emptyError={submitted && telegramEmpty}
      />
      <SlackChannel
        enabled={slackEnabled}
        onEnabledChange={setSlackEnabled}
        rows={slackRows}
        onRowsChange={setSlackRows}
        submitted={submitted}
        emptyError={submitted && slackEmpty}
      />
      {update.error && (
        <p className="text-destructive text-sm" role="alert">
          Couldn't save notification settings. {update.error.message}
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
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ChannelToggle({
  label,
  enabled,
  onEnabledChange,
}: {
  label: string;
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
}) {
  return (
    <Label className="flex items-center gap-2">
      <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      {label}
    </Label>
  );
}

// Visible, persistent field label — placeholders alone vanish once the user
// types, and these fields (chat ID vs token, name vs URL) are easy to confuse.
function LabeledField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function RemoveRowButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      onClick={onClick}
    >
      Remove
    </Button>
  );
}

function DisabledChannelSummary({
  count,
  noun,
}: {
  count: number;
  noun: string;
}) {
  if (count === 0) return null;
  return (
    <p className="pl-1 text-muted-foreground text-xs">
      {count} {count === 1 ? noun : `${noun}s`} saved · delivery off
    </p>
  );
}

function TelegramChannel({
  enabled,
  onEnabledChange,
  rows,
  onRowsChange,
  submitted,
  emptyError,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  rows: TelegramRow[];
  onRowsChange: (rows: TelegramRow[]) => void;
  submitted: boolean;
  emptyError: boolean;
}) {
  const setRow = (
    i: number,
    patch: Partial<Extract<TelegramRow, { kind: "new" }>>,
  ) =>
    onRowsChange(
      rows.map((r, j) =>
        j === i && r.kind === "new" ? { ...r, ...patch } : r,
      ),
    );
  const removeRow = (i: number) => onRowsChange(rows.filter((_, j) => j !== i));

  return (
    <div className="flex flex-col gap-2">
      <ChannelToggle
        label="Telegram"
        enabled={enabled}
        onEnabledChange={onEnabledChange}
      />
      {enabled ? (
        <div className="flex flex-col gap-2 pl-1">
          {rows.map((row, i) => {
            if (row.kind === "existing") {
              return (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {row.name ? (
                      <span className="font-medium">{row.name} · </span>
                    ) : null}
                    <span className="font-mono">{row.chatId}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · token saved
                    </span>
                  </span>
                  <RemoveRowButton
                    label={`Remove Telegram chat ${row.name ?? row.chatId}`}
                    onClick={() => removeRow(i)}
                  />
                </div>
              );
            }
            const error = telegramRowError(row);
            const showError = !!error && (submitted || error.immediate);
            return (
              <div
                key={row.key}
                className="flex flex-col gap-1 rounded border p-2"
              >
                <div className="flex items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <LabeledField
                      id={`tg-name-${row.key}`}
                      label="Name (optional)"
                    >
                      <Input
                        id={`tg-name-${row.key}`}
                        placeholder="e.g. On-call"
                        value={row.name}
                        onChange={(e) => setRow(i, { name: e.target.value })}
                      />
                    </LabeledField>
                    <LabeledField id={`tg-chat-${row.key}`} label="Chat ID">
                      <Input
                        id={`tg-chat-${row.key}`}
                        placeholder="-1001234567890"
                        value={row.chatId}
                        onChange={(e) => setRow(i, { chatId: e.target.value })}
                        aria-invalid={showError}
                      />
                    </LabeledField>
                    <LabeledField id={`tg-token-${row.key}`} label="Bot token">
                      <Input
                        id={`tg-token-${row.key}`}
                        type="password"
                        autoComplete="off"
                        placeholder="123456:ABC-DEF…"
                        value={row.botToken}
                        onChange={(e) =>
                          setRow(i, { botToken: e.target.value })
                        }
                      />
                    </LabeledField>
                  </div>
                  <RemoveRowButton
                    label="Remove this Telegram chat"
                    onClick={() => removeRow(i)}
                  />
                </div>
                {showError && error && (
                  <p className="text-destructive text-xs" role="alert">
                    {error.message}
                  </p>
                )}
              </div>
            );
          })}
          {rows.length === 0 && !emptyError && (
            <p className="text-muted-foreground text-xs">
              No Telegram chats yet. Add one to deliver alerts here.
            </p>
          )}
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => onRowsChange([...rows, newTelegramRow()])}
            >
              Add Telegram chat
            </Button>
            {emptyError && (
              <p className="text-destructive text-xs" role="alert">
                Telegram is on but has no chats. Add one, or turn Telegram off.
              </p>
            )}
          </div>
        </div>
      ) : (
        <DisabledChannelSummary
          count={rows.filter((r) => r.kind === "existing").length}
          noun="chat"
        />
      )}
    </div>
  );
}

function SlackChannel({
  enabled,
  onEnabledChange,
  rows,
  onRowsChange,
  submitted,
  emptyError,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  rows: SlackRow[];
  onRowsChange: (rows: SlackRow[]) => void;
  submitted: boolean;
  emptyError: boolean;
}) {
  const setRow = (
    i: number,
    patch: Partial<Extract<SlackRow, { kind: "new" }>>,
  ) =>
    onRowsChange(
      rows.map((r, j) =>
        j === i && r.kind === "new" ? { ...r, ...patch } : r,
      ),
    );
  const removeRow = (i: number) => onRowsChange(rows.filter((_, j) => j !== i));

  return (
    <div className="flex flex-col gap-2">
      <ChannelToggle
        label="Slack"
        enabled={enabled}
        onEnabledChange={onEnabledChange}
      />
      {enabled ? (
        <div className="flex flex-col gap-2 pl-1">
          {rows.map((row, i) => {
            if (row.kind === "existing") {
              return (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{row.name || "Webhook"}</span>
                    <span className="text-muted-foreground"> · saved</span>
                  </span>
                  <RemoveRowButton
                    label={`Remove Slack webhook ${row.name ?? ""}`.trim()}
                    onClick={() => removeRow(i)}
                  />
                </div>
              );
            }
            const error = slackRowError(row);
            const showError = !!error && (submitted || error.immediate);
            return (
              <div
                key={row.key}
                className="flex flex-col gap-1 rounded border p-2"
              >
                <div className="flex items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <LabeledField
                      id={`sl-name-${row.key}`}
                      label="Name (optional)"
                    >
                      <Input
                        id={`sl-name-${row.key}`}
                        placeholder="e.g. #incidents"
                        value={row.name}
                        onChange={(e) => setRow(i, { name: e.target.value })}
                      />
                    </LabeledField>
                    <LabeledField id={`sl-url-${row.key}`} label="Webhook URL">
                      <Input
                        id={`sl-url-${row.key}`}
                        type="password"
                        autoComplete="off"
                        placeholder="https://hooks.slack.com/services/…"
                        value={row.url}
                        onChange={(e) => setRow(i, { url: e.target.value })}
                        aria-invalid={showError}
                      />
                    </LabeledField>
                  </div>
                  <RemoveRowButton
                    label="Remove this Slack webhook"
                    onClick={() => removeRow(i)}
                  />
                </div>
                {showError && error && (
                  <p className="text-destructive text-xs" role="alert">
                    {error.message}
                  </p>
                )}
              </div>
            );
          })}
          {rows.length === 0 && !emptyError && (
            <p className="text-muted-foreground text-xs">
              No Slack webhooks yet. Add one to deliver alerts here.
            </p>
          )}
          <div className="flex flex-col gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => onRowsChange([...rows, newSlackRow()])}
            >
              Add Slack webhook
            </Button>
            {emptyError && (
              <p className="text-destructive text-xs" role="alert">
                Slack is on but has no webhooks. Add one, or turn Slack off.
              </p>
            )}
          </div>
        </div>
      ) : (
        <DisabledChannelSummary
          count={rows.filter((r) => r.kind === "existing").length}
          noun="webhook"
        />
      )}
    </div>
  );
}
