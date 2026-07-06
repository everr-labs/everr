// packages/app/src/routes/_authenticated/_dashboard/alerts_.notifications.tsx
//
// The single layered home for alert delivery configuration: where alerts go
// by default, the custom rules that redirect specific alerts elsewhere, and
// (collapsed) the advanced dependency-mute / webhook-feed / channel controls.
// Replaces the alerts list's notification-settings dialog and the retired
// power-user CC routing page.
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@everr/ui/components/collapsible";
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
import { useForm } from "@tanstack/react-form";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  BellMinus,
  ChevronDown,
  ChevronRight,
  Inbox,
  type LucideIcon,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Siren,
  Trash2,
  Waypoints,
  Webhook,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { InhibitionBuilder } from "@/components/cc/inhibition-builder";
import { matchersPhrase } from "@/components/cc/matchers-editor";
import { CcPipelineDiagram } from "@/components/cc/pipeline-diagram";
import { RouteBuilder } from "@/components/cc/route-builder";
import {
  CcEmptyState,
  CcQueryError,
  CcTableSkeleton,
  Conditions,
  ccErrorMessage,
  ccFormatTs,
} from "@/components/cc/shared";
import {
  emptyChannelError,
  isManagedCatchAllRoute,
  type NormalizedAlertDeliverySettings,
  slackWebhookUrlError,
  telegramBotTokenError,
} from "@/data/alerts/delivery-settings";
import {
  validateEmailRecipient,
  validateTelegramChatId,
} from "@/data/alerts/recipients";
import { updateAlertSettings } from "@/data/alerts/server";
import {
  createCcSubscription,
  deleteCcInhibition,
  deleteCcRoute,
  deleteCcSubscription,
  listCcAlerts,
  listCcInhibitions,
  listCcReceivers,
  listCcRoutes,
  listCcSilences,
  listCcSubscriptions,
} from "@/data/cc/server";
import type { CcReceiver, CcRoute } from "@/data/cc/types";
import { alertSettingsQueryOptions } from "./_previewable/alerts";

const q = {
  routes: () =>
    queryOptions({ queryKey: ["cc", "routes"], queryFn: () => listCcRoutes() }),
  receivers: () =>
    queryOptions({
      queryKey: ["cc", "receivers"],
      queryFn: () => listCcReceivers(),
    }),
  inhibitions: () =>
    queryOptions({
      queryKey: ["cc", "inhibitions"],
      queryFn: () => listCcInhibitions(),
    }),
  subscriptions: () =>
    queryOptions({
      queryKey: ["cc", "subscriptions"],
      queryFn: () => listCcSubscriptions(),
    }),
  alerts: () =>
    queryOptions({ queryKey: ["cc", "alerts"], queryFn: () => listCcAlerts() }),
  silences: () =>
    queryOptions({
      queryKey: ["cc", "silences"],
      queryFn: () => listCcSilences(),
    }),
};

export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts_/notifications",
)({
  staticData: { breadcrumb: "Notifications" },
  head: () => ({ meta: [{ title: "Everr - Notifications" }] }),
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.prefetchQuery(alertSettingsQueryOptions()),
      queryClient.prefetchQuery(q.routes()),
      queryClient.prefetchQuery(q.receivers()),
      queryClient.prefetchQuery(q.inhibitions()),
      queryClient.prefetchQuery(q.subscriptions()),
      queryClient.prefetchQuery(q.alerts()),
      queryClient.prefetchQuery(q.silences()),
    ]),
  component: NotificationsPage,
});

function NotificationsPage() {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Notifications</h1>
        <p className="text-muted-foreground">
          Where alerts go, the custom rules that redirect them, and advanced
          delivery controls.
        </p>
      </div>
      <WhereAlertsGoCard />
      <CustomRulesCard />
      <AdvancedSection />
    </div>
  );
}

// ── 1. Where alerts go ───────────────────────────────────────────────────────

function WhereAlertsGoCard() {
  const settings = useQuery(alertSettingsQueryOptions());
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where alerts go</CardTitle>
        <CardDescription>All alerts notify these channels.</CardDescription>
      </CardHeader>
      <CardContent>
        {settings.isError ? (
          <p className="text-destructive text-sm" role="alert">
            Unable to load notification settings.
          </p>
        ) : settings.data ? (
          <DeliverySettingsForm initial={settings.data.delivery} />
        ) : (
          <Skeleton className="h-48 w-full" />
        )}
      </CardContent>
    </Card>
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

function DeliverySettingsForm({
  initial,
}: {
  initial: NormalizedAlertDeliverySettings;
}) {
  const queryClient = useQueryClient();

  const update = useMutation({
    mutationFn: (delivery: NormalizedAlertDeliverySettings) =>
      updateAlertSettings({ data: { delivery } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["alerts", "settings"] });
      toast.success("Notification settings saved");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
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
      <div className="flex justify-end">
        <Button type="submit" disabled={update.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}

// ── 2. Custom notification rules ────────────────────────────────────────────

const CHANNEL_TYPE_LABEL: Record<CcReceiver["channel"]["type"], string> = {
  slack: "Slack",
  webhook: "Webhook",
  pagerduty: "PagerDuty",
  email: "Email",
  telegram: "Telegram",
};

function channelDisplayName(name: string, receivers: CcReceiver[]): string {
  const receiver = receivers.find((r) => r.name === name);
  return receiver
    ? `${name} (${CHANNEL_TYPE_LABEL[receiver.channel.type]})`
    : name;
}

function ruleSentence(route: CcRoute, receivers: CcReceiver[]): string {
  return `When ${matchersPhrase(route.matchers)}, also notify ${channelDisplayName(route.receiver, receivers)}.`;
}

function fmtTiming(seconds: number | null): string {
  return seconds === null ? "default" : `${seconds}s`;
}

function RuleTiming({ route }: { route: CcRoute }) {
  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger className="group inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3 transition-transform group-data-[panel-open]:rotate-90" />
        Timing
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-1.5 grid grid-cols-3 gap-3 text-xs">
          <div>
            <dt className="text-muted-foreground">wait</dt>
            <dd className="tabular-nums">{fmtTiming(route.group_wait_secs)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">bundle window</dt>
            <dd className="tabular-nums">
              {fmtTiming(route.group_interval_secs)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">remind every</dt>
            <dd className="tabular-nums">
              {fmtTiming(route.repeat_interval_secs)}
            </dd>
          </div>
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RuleRow({
  route,
  receivers,
  onEdit,
  onDelete,
  deleting,
}: {
  route: CcRoute;
  receivers: CcReceiver[];
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <li className="flex flex-col gap-2 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm">{ruleSentence(route, receivers)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Conditions matchers={route.matchers} emptyLabel="any alert" />
            <Badge variant="outline">Priority #{route.priority}</Badge>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit notification rule"
            onClick={onEdit}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete notification rule"
            disabled={deleting}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <RuleTiming route={route} />
    </li>
  );
}

function CustomRulesCard() {
  const qc = useQueryClient();
  const routesQuery = useQuery(q.routes());
  const receiversQuery = useQuery(q.receivers());
  const [editing, setEditing] = useState<CcRoute | "new" | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => deleteCcRoute({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "routes"] });
      toast.success("Notification rule deleted");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const receivers = receiversQuery.data ?? [];
  // Managed catch-all routes back the "Where alerts go" channels above; they
  // are not custom rules and never show up here.
  const rules = (routesQuery.data ?? [])
    .filter((r) => !isManagedCatchAllRoute(r))
    .sort((a, b) => a.priority - b.priority);

  return (
    <Card id="routes" inset="flush-content" className="scroll-mt-4">
      <CardHeader className="px-3">
        <CardTitle>Custom notification rules</CardTitle>
        <CardDescription>
          Send specific alerts to a specific channel. Checked top-to-bottom by
          priority; the first match wins.
        </CardDescription>
        <CardAction>
          <Button onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" />
            New rule
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {routesQuery.isError ? (
          <div className="px-3 pb-3">
            <CcQueryError error={routesQuery.error} />
          </div>
        ) : routesQuery.isPending ? (
          <CcTableSkeleton rows={3} />
        ) : rules.length === 0 ? (
          <CcEmptyState
            icon={Waypoints}
            title="No custom notification rules"
            hint="Add a rule to send specific alerts to a specific channel."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {rules.map((route) => (
              <RuleRow
                key={route.id}
                route={route}
                receivers={receivers}
                onEdit={() => setEditing(route)}
                onDelete={() => remove.mutate(route.id)}
                deleting={remove.isPending && remove.variables === route.id}
              />
            ))}
          </ul>
        )}
      </CardContent>
      <RouteBuilder
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        open={editing !== null}
        route={editing === "new" ? null : editing}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        receivers={receivers}
      />
    </Card>
  );
}

// ── 3. Advanced ──────────────────────────────────────────────────────────────

function PipelineOverview() {
  const routesQuery = useQuery(q.routes());
  const receiversQuery = useQuery(q.receivers());
  const inhibitionsQuery = useQuery(q.inhibitions());
  const alertsQuery = useQuery(q.alerts());
  const silencesQuery = useQuery(q.silences());

  const now = Date.now();
  const firing = (alertsQuery.data ?? []).filter(
    (a) => a.status === "firing",
  ).length;
  const activeMutes = (silencesQuery.data ?? []).filter(
    (s) =>
      new Date(s.starts_at).getTime() <= now &&
      now < new Date(s.ends_at).getTime(),
  ).length;

  return (
    <CcPipelineDiagram
      firing={firing}
      routeCount={(routesQuery.data ?? []).length}
      receiverCount={(receiversQuery.data ?? []).length}
      silenceCount={activeMutes}
      inhibitionCount={(inhibitionsQuery.data ?? []).length}
    />
  );
}

function DependencyMutesSection() {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(q.inhibitions());
  const [open, setOpen] = useState(false);

  const remove = useMutation({
    mutationFn: (id: string) => deleteCcInhibition({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "inhibitions"] });
      toast.success("Dependency mute deleted");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <div className="space-y-3 rounded-md border border-border/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Dependency mutes</h3>
          <p className="text-xs text-muted-foreground">
            Mute noisy downstream alerts while a related, higher-level alert is
            already firing.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus data-icon="inline-start" />
          New dependency mute
        </Button>
      </div>
      {isError ? (
        <CcQueryError error={error} />
      ) : isPending ? (
        <CcTableSkeleton rows={2} />
      ) : (data ?? []).length === 0 ? (
        <CcEmptyState
          icon={BellMinus}
          title="No dependency mutes"
          hint="Add one to mute downstream alerts while a higher-level alert is already firing."
        />
      ) : (
        <ul className="divide-y divide-border/60">
          {(data ?? []).map((r) => (
            <li
              key={r.id}
              className="flex items-start gap-3 py-2.5 text-xs leading-relaxed"
            >
              <div className="min-w-0 flex-1">
                While{" "}
                <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                  <Conditions matchers={r.source_matchers} />
                </span>{" "}
                fires, mute{" "}
                <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                  <Conditions matchers={r.target_matchers} />
                </span>
                {(r.equal ?? []).length > 0 && (
                  <>
                    {" "}
                    sharing{" "}
                    <span className="font-mono text-muted-foreground">
                      {(r.equal ?? []).join(", ")}
                    </span>
                  </>
                )}
                .
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete dependency mute"
                disabled={remove.isPending}
                onClick={() => remove.mutate(r.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <InhibitionBuilder open={open} onOpenChange={setOpen} />
    </div>
  );
}

function WebhookFeedSection() {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(q.subscriptions());
  const [url, setUrl] = useState("");

  const create = useMutation({
    mutationFn: () => createCcSubscription({ data: { webhookUrl: url } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "subscriptions"] });
      toast.success("Webhook added");
      setUrl("");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCcSubscription({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "subscriptions"] });
      toast.success("Webhook removed");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <div
      id="firehose"
      className="scroll-mt-4 space-y-3 rounded-md border border-border/60 p-3"
    >
      <div>
        <h3 className="text-sm font-medium">Webhook feed</h3>
        <p className="text-xs text-muted-foreground">
          The fallback: alerts that match no custom notification rule are
          delivered to every webhook below.
        </p>
      </div>
      {isError ? (
        <CcQueryError error={error} />
      ) : isPending ? (
        <CcTableSkeleton rows={2} />
      ) : (data ?? []).length === 0 ? (
        <CcEmptyState
          icon={Webhook}
          title="No webhooks"
          hint="Add a webhook URL below to receive every alert that matches no custom notification rule."
        />
      ) : (
        <ul className="divide-y divide-border/60">
          {(data ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Webhook className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs">
                  {s.webhook_url}
                </div>
                <div className="text-xs text-muted-foreground">
                  Added {ccFormatTs(s.created_at)}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete webhook"
                disabled={remove.isPending}
                onClick={() => remove.mutate(s.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (url && !create.isPending) create.mutate();
        }}
      >
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="webhook-feed-url">Webhook URL</Label>
          <Input
            id="webhook-feed-url"
            type="url"
            className="font-mono"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/hook"
          />
        </div>
        <Button type="submit" disabled={!url || create.isPending}>
          <Plus data-icon="inline-start" />
          Add
        </Button>
      </form>
    </div>
  );
}

// Ownership marker the as-code receiver reconciler stamps (data/cc/apply.server.ts).
const RECEIVER_MANAGED_KEY = "everr.managed";
const RECEIVER_MANAGED_AS_CODE = "as-code";
const isAsCodeReceiver = (r: CcReceiver): boolean =>
  r.annotations?.[RECEIVER_MANAGED_KEY] === RECEIVER_MANAGED_AS_CODE;

const CHANNEL_ICON: Record<CcReceiver["channel"]["type"], LucideIcon> = {
  slack: MessageSquare,
  webhook: Webhook,
  pagerduty: Siren,
  email: Mail,
  telegram: Send,
};

function channelTarget(c: CcReceiver["channel"]): string {
  switch (c.type) {
    case "slack":
    case "webhook":
      return c.url ?? "";
    case "pagerduty":
      return c.routing_key ?? "";
    case "email":
      return (c.to ?? []).join(", ");
    case "telegram":
      return (c.chat_ids ?? []).join(", ");
  }
}

function ChannelsSection() {
  const { data, isPending, isError, error } = useQuery(q.receivers());
  return (
    <div
      id="receivers"
      className="scroll-mt-4 space-y-2 rounded-md border border-border/60 p-3"
    >
      <div>
        <h3 className="text-sm font-medium">Channels</h3>
        <p className="text-xs text-muted-foreground">
          Ones managed as code with{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem]">
            everr apply
          </code>{" "}
          are marked <span className="font-medium">as code</span>; secrets are
          redacted here. Not editable in the UI.
        </p>
      </div>
      {isError ? (
        <CcQueryError error={error} />
      ) : isPending ? (
        <CcTableSkeleton rows={3} />
      ) : (data ?? []).length === 0 ? (
        <CcEmptyState
          icon={Inbox}
          title="No channels defined"
          hint="Define Slack, webhook, PagerDuty, or email channels as code, then apply them."
        />
      ) : (
        <ul className="divide-y divide-border/60">
          {(data ?? []).map((r) => {
            const Icon = CHANNEL_ICON[r.channel.type];
            return (
              <li key={r.name} className="flex items-center gap-3 py-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{r.name}</span>
                    {isAsCodeReceiver(r) ? (
                      <Badge variant="outline">as code</Badge>
                    ) : null}
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {channelTarget(r.channel) || r.channel.type}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {r.channel.type}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AdvancedSection() {
  return (
    <Collapsible defaultOpen={false}>
      <Card inset="flush-content">
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/30">
          <div>
            <CardTitle>Advanced</CardTitle>
            <CardDescription>
              The delivery pipeline, dependency mutes, the webhook feed, and
              read-only channels.
            </CardDescription>
          </div>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 pb-3 pt-1">
            <PipelineOverview />
            <DependencyMutesSection />
            <WebhookFeedSection />
            <ChannelsSection />
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
