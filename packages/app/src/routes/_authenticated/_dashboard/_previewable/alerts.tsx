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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { Skeleton } from "@everr/ui/components/skeleton";
import { Switch } from "@everr/ui/components/switch";
import { TagsInput } from "@everr/ui/components/tags-input";
import { cn } from "@everr/ui/lib/utils";
import { useForm } from "@tanstack/react-form";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { NotebookText, SearchIcon, Settings, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { PreviewStatusBadge } from "@/components/preview-status-badge";
import {
  emptyChannelError,
  type NormalizedAlertDeliverySettings,
  slackWebhookUrlError,
  telegramBotTokenError,
} from "@/data/alerts/delivery-settings";
import {
  validateEmailRecipient,
  validateTelegramChatId,
} from "@/data/alerts/recipients";
import { formatRunbookRef } from "@/data/alerts/schema";
import {
  type AlertSummary,
  getAlertSettings,
  listAlerts,
  updateAlertSettings,
} from "@/data/alerts/server";
import { useCcInvalidation } from "@/hooks/use-cc-invalidation";
import {
  AlertStateBadges,
  formatInterval,
  isEvaluationStale,
  QueryErrorMessage,
  RelativeTime,
  SeverityBadge,
} from "./-alerts-shared";

const alertsQueryOptions = (preview?: string) =>
  queryOptions({
    // Keyed under the shared "alerts" prefix so mutation invalidations hit
    // every preview variant of the list.
    queryKey: ["alerts", "list", preview ?? ""],
    queryFn: () => listAlerts({ data: { preview } }),
  });

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
      return alert.active && alert.health !== "healthy";
    case "silenced":
      return alert.activeSilenceCount > 0;
    case "resolved":
      return alert.active && alert.currentState === "resolved";
    case "inactive":
      return !alert.active;
  }
}

function alertMatchesSearch(alert: AlertSummary, query: string) {
  if (!query) return true;
  return [
    alert.displayName,
    alert.slug,
    alert.repoid,
    alert.runbookProject,
    alert.runbookSlug,
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

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts",
)({
  staticData: { breadcrumb: "Alerts", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Alerts" }] }),
  // Preview is app-wide search state; declaring it as a loader dep keys the
  // prefetch to the same preview the component reads, so switching previews
  // refetches instead of serving the wrong overlay.
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: async ({ context: { queryClient }, deps: { preview } }) => {
    await Promise.all([
      queryClient.prefetchQuery(alertsQueryOptions(preview)),
      queryClient.prefetchQuery(alertSettingsQueryOptions()),
    ]);
  },
  component: AlertsPage,
});

function AlertsPage() {
  useCcInvalidation();
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });
  const alerts = useQuery(alertsQueryOptions(preview));
  const settings = useQuery(alertSettingsQueryOptions());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [alertFilter, setAlertFilter] = useState<AlertListFilter>("all");
  const [alertSearch, setAlertSearch] = useState("");

  const summary = useMemo(() => {
    let firing = 0;
    let errored = 0;
    let resolved = 0;
    let inactive = 0;
    let silenced = 0;
    for (const a of alerts.data ?? []) {
      if (a.activeSilenceCount > 0) silenced += 1;
      if (!a.active) inactive += 1;
      else {
        if (a.health !== "healthy") errored += 1;
        if (a.currentState === "firing") firing += 1;
        else if (a.currentState === "resolved") resolved += 1;
      }
    }
    return {
      total: alerts.data?.length ?? 0,
      firing,
      errored,
      resolved,
      inactive,
      silenced,
    };
  }, [alerts.data]);

  const filterOptions = useMemo<AlertFilterOption[]>(() => {
    const all: AlertFilterOption[] = [
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
      { value: "inactive", label: "Inactive", count: summary.inactive },
    ];
    // Hide empty categories, but always keep "All" and whichever chip is the
    // active filter (so the current selection never vanishes from the row).
    return all.filter(
      (o) => o.value === "all" || o.count > 0 || o.value === alertFilter,
    );
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
    ((delivery.email.enabled && delivery.email.to.length > 0) ||
      (delivery.telegram.enabled &&
        delivery.telegram.chatIds.length > 0 &&
        delivery.telegram.botToken.length > 0) ||
      (delivery.slack.enabled && delivery.slack.webhookUrl.length > 0));

  const columns = useMemo<Column<AlertSummary>[]>(
    () => [
      {
        header: "Alert",
        cell: (row) => (
          <span className="flex items-center gap-2">
            <Link
              to="/alerts/$alertId"
              params={{ alertId: row.id }}
              className="min-w-0 underline-offset-4 hover:underline"
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
            <PreviewStatusBadge status={row.previewStatus} />
          </span>
        ),
      },
      {
        header: "State",
        cell: (row) => (
          <AlertStateBadges
            state={row.currentState}
            active={row.active}
            firingInstanceCount={row.firingInstanceCount}
            activeSilenceCount={row.activeSilenceCount}
            activeSilenceExpiresAt={row.activeSilenceExpiresAt}
          />
        ),
      },
      {
        header: "Severity",
        cell: (row) => <SeverityBadge severity={row.severity} />,
      },
      {
        header: "Last seen",
        cell: (row) => {
          const stale = isEvaluationStale(
            row.lastSeenAt,
            row.evaluationIntervalSeconds,
          );
          return (
            <span className="flex items-center gap-1.5">
              <span className={stale ? "text-amber-500" : undefined}>
                <RelativeTime value={row.lastSeenAt} />
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
      {
        header: "Runbook",
        cell: (row) =>
          row.runbookProject && row.runbookSlug ? (
            <Link
              to="/runbooks/$project/$slug"
              params={{ project: row.runbookProject, slug: row.runbookSlug }}
              className="inline-flex items-center text-muted-foreground hover:text-foreground"
              title={formatRunbookRef(row.runbookProject, row.runbookSlug)}
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
              rowClassName={(row) =>
                row.previewStatus === "removed" ? "opacity-50" : undefined
              }
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

function ChannelField({
  label,
  recipientsLabel,
  placeholder,
  enabled,
  onEnabledChange,
  recipients,
  onRecipientsChange,
  validate,
  error,
}: {
  label: string;
  recipientsLabel: string;
  placeholder: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  recipients: string[];
  onRecipientsChange: (recipients: string[]) => void;
  validate: (value: string) => string | null;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        {label}
      </Label>
      <TagsInput
        aria-label={recipientsLabel}
        placeholder={placeholder}
        disabled={!enabled}
        value={recipients}
        onValueChange={onRecipientsChange}
        validate={validate}
      />
      {error && (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
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

function NotificationSettingsForm({
  initial,
  onClose,
}: {
  initial: NormalizedAlertDeliverySettings;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const update = useMutation({
    mutationFn: (delivery: NormalizedAlertDeliverySettings) =>
      updateAlertSettings({ data: { delivery } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts", "settings"] });
      onClose();
    },
  });

  const form = useForm({
    defaultValues: initial,
    // Failures stay in the mutation state and render inline.
    onSubmit: ({ value }) => update.mutate(value),
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="flex flex-col gap-4">
        <form.Field
          name="email.enabled"
          listeners={{
            // Re-check the recipients rule when the channel is toggled.
            onChange: ({ fieldApi }) =>
              fieldApi.form.validateField("email.to", "change"),
          }}
        >
          {(enabledField) => (
            <form.Field
              name="email.to"
              validators={{
                onChange: ({ value, fieldApi }) =>
                  emptyChannelError(
                    "email",
                    fieldApi.form.state.values.email.enabled,
                    value,
                  ),
              }}
            >
              {(toField) => (
                <ChannelField
                  label="Email"
                  recipientsLabel="Email recipients"
                  placeholder="team@example.com"
                  enabled={enabledField.state.value}
                  onEnabledChange={enabledField.handleChange}
                  recipients={toField.state.value}
                  onRecipientsChange={toField.handleChange}
                  validate={validateEmailRecipient}
                  error={toField.state.meta.errors[0]}
                />
              )}
            </form.Field>
          )}
        </form.Field>
        <form.Field
          name="telegram.enabled"
          listeners={{
            onChange: ({ fieldApi }) =>
              void Promise.all([
                fieldApi.form.validateField("telegram.chatIds", "change"),
                fieldApi.form.validateField("telegram.botToken", "change"),
              ]),
          }}
        >
          {(enabledField) => (
            <div className="flex flex-col gap-2">
              <form.Field
                name="telegram.chatIds"
                validators={{
                  onChange: ({ value, fieldApi }) =>
                    emptyChannelError(
                      "telegram",
                      fieldApi.form.state.values.telegram.enabled,
                      value,
                    ),
                }}
              >
                {(chatIdsField) => (
                  <ChannelField
                    label="Telegram"
                    recipientsLabel="Telegram chat IDs"
                    placeholder="-1001234567890"
                    enabled={enabledField.state.value}
                    onEnabledChange={enabledField.handleChange}
                    recipients={chatIdsField.state.value}
                    onRecipientsChange={chatIdsField.handleChange}
                    validate={validateTelegramChatId}
                    error={chatIdsField.state.meta.errors[0]}
                  />
                )}
              </form.Field>
              <form.Field
                name="telegram.botToken"
                validators={{
                  onChange: ({ value, fieldApi }) =>
                    telegramBotTokenError(
                      fieldApi.form.state.values.telegram.enabled,
                      value,
                    ),
                }}
              >
                {(botTokenField) => (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="telegram-bot-token">
                      Telegram bot token
                    </Label>
                    <Input
                      id="telegram-bot-token"
                      type="password"
                      autoComplete="off"
                      disabled={!enabledField.state.value}
                      placeholder="123456789:ABC..."
                      value={botTokenField.state.value}
                      onChange={(event) =>
                        botTokenField.handleChange(event.target.value)
                      }
                      onBlur={botTokenField.handleBlur}
                      aria-invalid={botTokenField.state.meta.errors.length > 0}
                    />
                    {botTokenField.state.meta.errors[0] && (
                      <p className="text-destructive text-xs" role="alert">
                        {botTokenField.state.meta.errors[0]}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
            </div>
          )}
        </form.Field>
        <form.Field
          name="slack.enabled"
          listeners={{
            onChange: ({ fieldApi }) =>
              fieldApi.form.validateField("slack.webhookUrl", "change"),
          }}
        >
          {(enabledField) => (
            <div className="flex flex-col gap-2">
              <Label className="flex items-center gap-2">
                <Switch
                  checked={enabledField.state.value}
                  onCheckedChange={enabledField.handleChange}
                />
                Slack
              </Label>
              <form.Field
                name="slack.webhookUrl"
                validators={{
                  onChange: ({ value, fieldApi }) =>
                    slackWebhookUrlError(
                      fieldApi.form.state.values.slack.enabled,
                      value,
                    ),
                }}
              >
                {(webhookUrlField) => (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="slack-webhook-url">Slack webhook URL</Label>
                    <Input
                      id="slack-webhook-url"
                      type="password"
                      autoComplete="off"
                      disabled={!enabledField.state.value}
                      placeholder="https://hooks.slack.com/services/..."
                      value={webhookUrlField.state.value}
                      onChange={(event) =>
                        webhookUrlField.handleChange(event.target.value)
                      }
                      onBlur={webhookUrlField.handleBlur}
                      aria-invalid={
                        webhookUrlField.state.meta.errors.length > 0
                      }
                    />
                    {webhookUrlField.state.meta.errors[0] && (
                      <p className="text-destructive text-xs" role="alert">
                        {webhookUrlField.state.meta.errors[0]}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
            </div>
          )}
        </form.Field>
        <form.Field name="remindEverySeconds">
          {(field) => (
            <div className="flex flex-col gap-1">
              <Label htmlFor="remind-every">Remind every</Label>
              <Select
                value={
                  field.state.value === null ? "off" : String(field.state.value)
                }
                onValueChange={(value) =>
                  field.handleChange(value === "off" ? null : Number(value))
                }
              >
                <SelectTrigger id="remind-every">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="3600">1 hour</SelectItem>
                  <SelectItem value="14400">4 hours</SelectItem>
                  <SelectItem value="86400">24 hours</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Re-send notifications while an alert stays firing
              </p>
            </div>
          )}
        </form.Field>
        {update.error && (
          <p className="text-destructive text-sm" role="alert">
            {update.error.message}
          </p>
        )}
      </div>
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
