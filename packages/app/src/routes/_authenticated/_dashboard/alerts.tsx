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
import { Skeleton } from "@everr/ui/components/skeleton";
import { Switch } from "@everr/ui/components/switch";
import { TagsInput } from "@everr/ui/components/tags-input";
import { useForm } from "@tanstack/react-form";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useMemo, useState } from "react";
import {
  emptyChannelError,
  type NormalizedAlertDeliverySettings,
  telegramBotTokenError,
} from "@/data/alerts/delivery-settings";
import {
  validateEmailRecipient,
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
    ((delivery.email.enabled && delivery.email.to.length > 0) ||
      (delivery.telegram.enabled &&
        delivery.telegram.chatIds.length > 0 &&
        delivery.telegram.botToken.length > 0));

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
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          <CardDescription>
            One row per rule. Open a rule to see its alert instances.
          </CardDescription>
        </CardHeader>
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
