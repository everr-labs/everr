import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowRight,
  BellMinus,
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
import { CcPipelineDiagram } from "@/components/cc/pipeline-diagram";
import { ReceiverBuilder } from "@/components/cc/receiver-builder";
import { RouteBuilder } from "@/components/cc/route-builder";
import {
  createCcSubscription,
  deleteCcInhibition,
  deleteCcReceiver,
  deleteCcRoute,
  deleteCcSubscription,
  listCcAlerts,
  listCcInhibitions,
  listCcReceivers,
  listCcRoutes,
  listCcSilences,
  listCcSubscriptions,
} from "@/data/cc/server";
import type { CcInhibition, CcReceiver, CcRoute } from "@/data/cc/types";
import {
  CcEmptyState,
  CcQueryError,
  CcTableSkeleton,
  ccErrorMessage,
  ccFormatTs,
  Matchers,
} from "./-cc-shared";

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
  alerts: () =>
    queryOptions({ queryKey: ["cc", "alerts"], queryFn: () => listCcAlerts() }),
  silences: () =>
    queryOptions({
      queryKey: ["cc", "silences"],
      queryFn: () => listCcSilences(),
    }),
  subscriptions: () =>
    queryOptions({
      queryKey: ["cc", "subscriptions"],
      queryFn: () => listCcSubscriptions(),
    }),
};

export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts/routing",
)({
  staticData: { breadcrumb: "Routing" },
  head: () => ({ meta: [{ title: "Everr - Alerts Routing" }] }),
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.prefetchQuery(q.routes()),
      queryClient.prefetchQuery(q.receivers()),
      queryClient.prefetchQuery(q.inhibitions()),
      queryClient.prefetchQuery(q.alerts()),
      queryClient.prefetchQuery(q.silences()),
      queryClient.prefetchQuery(q.subscriptions()),
    ]),
  component: CcRoutingPage,
});

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

// ── Sections ──────────────────────────────────────────────────────────────────

function ReceiversSection() {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(q.receivers());
  const [open, setOpen] = useState(false);

  const remove = useMutation({
    mutationFn: (name: string) => deleteCcReceiver({ data: { name } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "receivers"] });
      toast.success("Receiver deleted");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <Card id="receivers" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Receivers</CardTitle>
        <CardDescription>
          The channels alerts can be delivered to. Secret fields are redacted
          here.
        </CardDescription>
        <CardAction>
          <Button onClick={() => setOpen(true)}>
            <Plus data-icon="inline-start" />
            New receiver
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isError ? (
          <div className="px-3 pb-3">
            <CcQueryError error={error} />
          </div>
        ) : isPending ? (
          <CcTableSkeleton rows={3} />
        ) : (data ?? []).length === 0 ? (
          <CcEmptyState
            icon={Inbox}
            title="No receivers defined"
            hint="Add a Slack, webhook, PagerDuty, email, or Telegram channel for routes to deliver alerts to."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((r) => {
              const Icon = CHANNEL_ICON[r.channel.type];
              // Free-form annotations minus `everr.`-prefixed internal markers
              // (stamped by older flows; not user metadata).
              const customAnnotations = Object.entries(
                r.annotations ?? {},
              ).filter(([k]) => !k.startsWith("everr."));
              return (
                <li
                  key={r.name}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{r.name}</span>
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {channelTarget(r.channel) || r.channel.type}
                    </div>
                    {customAnnotations.length > 0 && (
                      <div className="truncate text-xs text-muted-foreground">
                        {customAnnotations
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(", ")}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {r.channel.type}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete receiver"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(r.name)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <ReceiverBuilder
        key={open ? "open" : "closed"}
        open={open}
        onOpenChange={setOpen}
        existingNames={(data ?? []).map((r) => r.name)}
      />
    </Card>
  );
}

function routeGroupingSummary(r: CcRoute): string[] {
  const parts: string[] = [];
  if (r.group_by && r.group_by.length > 0)
    parts.push(`group by ${r.group_by.join(", ")}`);
  if (r.group_wait_secs != null) parts.push(`wait ${r.group_wait_secs}s`);
  if (r.group_interval_secs != null)
    parts.push(`interval ${r.group_interval_secs}s`);
  if (r.repeat_interval_secs != null)
    parts.push(`repeat ${r.repeat_interval_secs}s`);
  if (r.continue) parts.push("continue");
  return parts;
}

function RoutesSection({ receivers }: { receivers: CcReceiver[] }) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(q.routes());
  const [editing, setEditing] = useState<CcRoute | "new" | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => deleteCcRoute({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "routes"] });
      toast.success("Route deleted");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const sorted = [...(data ?? [])].sort((a, b) => a.priority - b.priority);

  return (
    <Card id="routes" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Routes</CardTitle>
        <CardDescription>
          Checked top-to-bottom by priority; the first match decides the
          receiver. Alerts matching no route fall through to the firehose below.
        </CardDescription>
        <CardAction>
          <Button onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" />
            New route
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isError ? (
          <div className="px-3 pb-3">
            <CcQueryError error={error} />
          </div>
        ) : isPending ? (
          <CcTableSkeleton rows={3} />
        ) : sorted.length === 0 ? (
          <CcEmptyState
            icon={Waypoints}
            title="No routes configured"
            hint="Without routes, every alert is delivered to all firehose subscriptions. Add a route to direct matching alerts to a receiver."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {sorted.map((r: CcRoute) => {
              const summary = routeGroupingSummary(r);
              return (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="w-8 shrink-0 text-center font-mono text-xs text-muted-foreground tabular-nums">
                    #{r.priority}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Matchers matchers={r.matchers} emptyLabel="any alert" />
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                      <span className="font-mono text-xs">{r.receiver}</span>
                    </div>
                    {summary.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {summary.join(" · ")}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Edit route"
                    onClick={() => setEditing(r)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete route"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(r.id)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
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

function InhibitionsSection() {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(q.inhibitions());
  const [open, setOpen] = useState(false);

  const remove = useMutation({
    mutationFn: (id: string) => deleteCcInhibition({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "inhibitions"] });
      toast.success("Inhibition deleted");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <Card id="inhibitions" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Inhibitions</CardTitle>
        <CardDescription>
          Suppress noisy downstream alerts while a related, higher-level alert
          is already firing.
        </CardDescription>
        <CardAction>
          <Button onClick={() => setOpen(true)}>
            <Plus data-icon="inline-start" />
            New inhibition
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isError ? (
          <div className="px-3 pb-3">
            <CcQueryError error={error} />
          </div>
        ) : isPending ? (
          <CcTableSkeleton rows={2} />
        ) : (data ?? []).length === 0 ? (
          <CcEmptyState
            icon={BellMinus}
            title="No inhibition rules"
            hint="Add a rule to mute downstream alerts while a higher-level alert is already firing."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((r: CcInhibition) => (
              <li
                key={r.id}
                className="flex items-start gap-3 px-3 py-2.5 text-xs leading-relaxed"
              >
                <div className="min-w-0 flex-1">
                  While{" "}
                  <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                    <Matchers matchers={r.source_matchers} />
                  </span>{" "}
                  fires, suppress{" "}
                  <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                    <Matchers matchers={r.target_matchers} />
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
                  aria-label="Delete inhibition"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(r.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <InhibitionBuilder open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function FirehoseSection() {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(q.subscriptions());
  const [url, setUrl] = useState("");

  const create = useMutation({
    mutationFn: () => createCcSubscription({ data: { webhookUrl: url } }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ["cc", "subscriptions"] });
      toast.success(`Subscription created (${s.id.slice(0, 8)})`);
      setUrl("");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCcSubscription({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "subscriptions"] });
      toast.success("Subscription deleted");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <Card id="firehose" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Firehose subscriptions</CardTitle>
        <CardDescription>
          The fallback: alerts that match no route are delivered to every
          firehose webhook.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isError ? (
          <div className="px-3">
            <CcQueryError error={error} />
          </div>
        ) : isPending ? (
          <CcTableSkeleton rows={2} />
        ) : (data ?? []).length === 0 ? (
          <CcEmptyState
            icon={Webhook}
            title="No firehose subscriptions"
            hint="Add a webhook URL below to receive every alert that matches no route."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
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
                  aria-label="Delete subscription"
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
          className="flex items-end gap-2 px-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (url && !create.isPending) create.mutate();
          }}
        >
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="firehose-url">Webhook URL</Label>
            <Input
              id="firehose-url"
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
      </CardContent>
    </Card>
  );
}

function CcRoutingPage() {
  const routes = useQuery(q.routes());
  const receivers = useQuery(q.receivers());
  const inhibitions = useQuery(q.inhibitions());
  const alerts = useQuery(q.alerts());
  const silences = useQuery(q.silences());

  const now = Date.now();
  const firing = (alerts.data ?? []).filter(
    (a) => a.status === "firing",
  ).length;
  const activeSilences = (silences.data ?? []).filter(
    (s) =>
      new Date(s.starts_at).getTime() <= now &&
      now < new Date(s.ends_at).getTime(),
  ).length;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Delivery pipeline</CardTitle>
          <CardDescription>
            When an alert fires, this is the path it takes to reach a person.
            Jump to any stage to configure it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CcPipelineDiagram
            firing={firing}
            routeCount={(routes.data ?? []).length}
            receiverCount={(receivers.data ?? []).length}
            silenceCount={activeSilences}
            inhibitionCount={(inhibitions.data ?? []).length}
          />
        </CardContent>
      </Card>

      <ReceiversSection />
      <RoutesSection receivers={receivers.data ?? []} />
      <InhibitionsSection />
      <FirehoseSection />
    </div>
  );
}
