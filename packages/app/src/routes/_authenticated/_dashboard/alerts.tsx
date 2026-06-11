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
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { AlertStateBadges, formatDate, formatInterval } from "./-alerts-shared";

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
  const queryClient = useQueryClient();
  const settings = useQuery(alertSettingsQueryOptions());
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailTo, setEmailTo] = useState<string[]>([]);
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramChatIds, setTelegramChatIds] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    telegram?: string;
  }>({});

  useEffect(() => {
    const delivery = settings.data?.delivery;
    if (!delivery || !open) return;
    setEmailEnabled(delivery.email.enabled);
    setEmailTo(delivery.email.to);
    setTelegramEnabled(delivery.telegram.enabled);
    setTelegramChatIds(delivery.telegram.chatIds);
    setFieldErrors({});
  }, [settings.data, open]);

  const update = useMutation({
    mutationFn: () =>
      updateAlertSettings({
        data: {
          delivery: {
            email: { enabled: emailEnabled, to: emailTo },
            telegram: {
              enabled: telegramEnabled,
              chatIds: telegramChatIds,
            },
          },
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts", "settings"] });
      onOpenChange(false);
    },
  });

  function save() {
    const errors: { email?: string; telegram?: string } = {};
    if (emailEnabled && emailTo.length === 0) {
      errors.email = "Email is enabled but has no recipients.";
    }
    if (telegramEnabled && telegramChatIds.length === 0) {
      errors.telegram = "Telegram is enabled but has no chat IDs.";
    }
    setFieldErrors(errors);
    if (errors.email || errors.telegram) return;
    update.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notification settings</DialogTitle>
          <DialogDescription>
            Organization-level delivery for alert notifications.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <ChannelField
            label="Email"
            recipientsLabel="Email recipients"
            placeholder="team@example.com"
            enabled={emailEnabled}
            onEnabledChange={(enabled) => {
              setEmailEnabled(enabled);
              setFieldErrors((errors) => ({ ...errors, email: undefined }));
            }}
            recipients={emailTo}
            onRecipientsChange={(recipients) => {
              setEmailTo(recipients);
              setFieldErrors((errors) => ({ ...errors, email: undefined }));
            }}
            validate={validateEmailRecipient}
            error={fieldErrors.email}
          />
          <ChannelField
            label="Telegram"
            recipientsLabel="Telegram chat IDs"
            placeholder="-1001234567890"
            enabled={telegramEnabled}
            onEnabledChange={(enabled) => {
              setTelegramEnabled(enabled);
              setFieldErrors((errors) => ({ ...errors, telegram: undefined }));
            }}
            recipients={telegramChatIds}
            onRecipientsChange={(recipients) => {
              setTelegramChatIds(recipients);
              setFieldErrors((errors) => ({ ...errors, telegram: undefined }));
            }}
            validate={validateTelegramChatId}
            error={fieldErrors.telegram}
          />
          {update.error && (
            <p className="text-destructive" role="alert">
              {update.error.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            Cancel
          </Button>
          <Button disabled={update.isPending} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
