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
  formatDate,
  formatInterval,
  QueryErrorMessage,
  safeExternalHref,
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
  const [settingsOpen, setSettingsOpen] = useState(false);

  const columns = useMemo<Column<AlertSummary>[]>(
    () => [
      {
        header: "Alert",
        cell: (row) => (
          <Link
            to="/alerts/$alertId"
            params={{ alertId: row.id }}
            className="font-mono underline-offset-4 hover:underline"
          >
            {row.slug}
          </Link>
        ),
      },
      { header: "Repo", cell: (row) => row.repoid },
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
      { header: "Last eval", cell: (row) => formatDate(row.lastEvaluatedAt) },
      {
        header: "Interval",
        cell: (row) => formatInterval(row.evaluationIntervalSeconds),
      },
      {
        header: "Source",
        cell: (row) => {
          const href = safeExternalHref(row.sourceLink);
          return href ? (
            <a
              className="underline"
              href={href}
              target="_blank"
              rel="noreferrer"
            >
              source
            </a>
          ) : (
            row.configFilePath || "-"
          );
        },
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
                  No alerts have been applied for this organization.
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
            Organization-level delivery for alert notifications.
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
              fieldApi.form.validateField("telegram.chatIds", "change"),
          }}
        >
          {(enabledField) => (
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
