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
  Dialog,
  DialogContent,
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
  Plus,
  Send,
  Siren,
  Trash2,
  Waypoints,
  Webhook,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  MatchersEditor,
  matchersPhrase,
} from "@/components/cc/matchers-editor";
import { CcPipelineDiagram } from "@/components/cc/pipeline-diagram";
import {
  createCcInhibition,
  createCcRoute,
  createCcSubscription,
  deleteCcInhibition,
  deleteCcRoute,
  listCcAlerts,
  listCcInhibitions,
  listCcReceivers,
  listCcRoutes,
  listCcSilences,
} from "@/data/cc/server";
import type {
  CcInhibition,
  CcMatcher,
  CcReceiver,
  CcRoute,
} from "@/data/cc/types";
import {
  CcConceptNote,
  CcEmptyState,
  CcQueryError,
  CcTableSkeleton,
  ccErrorMessage,
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
};

export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/routing",
)({
  staticData: { breadcrumb: "Routing" },
  head: () => ({ meta: [{ title: "Everr - Clickety-Clack Routing" }] }),
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.prefetchQuery(q.routes()),
      queryClient.prefetchQuery(q.receivers()),
      queryClient.prefetchQuery(q.inhibitions()),
      queryClient.prefetchQuery(q.alerts()),
      queryClient.prefetchQuery(q.silences()),
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

function PreviewLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed [&_strong]:font-medium [&_strong]:text-foreground">
      {children}
    </div>
  );
}

// ── Route builder ─────────────────────────────────────────────────────────────

function RouteBuilder({
  open,
  onOpenChange,
  receivers,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  receivers: CcReceiver[];
}) {
  const qc = useQueryClient();
  const [matchers, setMatchers] = useState<CcMatcher[]>([]);
  const [receiver, setReceiver] = useState("");
  const [priority, setPriority] = useState(0);

  const create = useMutation({
    mutationFn: () =>
      createCcRoute({
        data: {
          matchers,
          receiver,
          continue: false,
          priority,
          group_by: null,
          group_wait_secs: null,
          group_interval_secs: null,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "routes"] });
      onOpenChange(false);
      setMatchers([]);
      setReceiver("");
      setPriority(0);
      toast.success("Route created");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New route</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <CcConceptNote>
            A route sends matching alerts to one receiver. Lower priority
            numbers are checked first; the first matching route wins.
          </CcConceptNote>
          <MatchersEditor
            label="When an alert matches"
            value={matchers}
            onChange={setMatchers}
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="route-receiver">Send to receiver</Label>
              {receivers.length > 0 ? (
                <Select
                  value={receiver}
                  onValueChange={(v) => setReceiver(v ?? "")}
                >
                  <SelectTrigger id="route-receiver" className="w-full">
                    <SelectValue placeholder="Pick a receiver" />
                  </SelectTrigger>
                  <SelectContent>
                    {receivers.map((r) => (
                      <SelectItem key={r.name} value={r.name}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="route-receiver"
                  value={receiver}
                  onChange={(e) => setReceiver(e.target.value)}
                  placeholder="oncall"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="route-priority">Priority</Label>
              <Input
                id="route-priority"
                type="number"
                className="tabular-nums"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />
            </div>
          </div>
          <PreviewLine>
            Alerts where <strong>{matchersPhrase(matchers)}</strong>{" "}
            <ArrowRight className="inline size-3 text-muted-foreground" />{" "}
            notify <strong>{receiver || "a receiver"}</strong>.
          </PreviewLine>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!receiver || create.isPending}
            onClick={() => create.mutate()}
          >
            Create route
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Inhibition builder ────────────────────────────────────────────────────────

function InhibitionBuilder({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const [source, setSource] = useState<CcMatcher[]>([]);
  const [target, setTarget] = useState<CcMatcher[]>([]);
  const [equal, setEqual] = useState("");

  const create = useMutation({
    mutationFn: () =>
      createCcInhibition({
        data: {
          source_matchers: source,
          target_matchers: target,
          equal: equal
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "inhibitions"] });
      onOpenChange(false);
      setSource([]);
      setTarget([]);
      setEqual("");
      toast.success("Inhibition created");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const equalLabels = equal
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New inhibition</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <CcConceptNote>
            While a <strong>source</strong> alert is firing, matching{" "}
            <strong>target</strong> alerts are suppressed — as long as they
            share the same values for the <strong>equal</strong> labels.
          </CcConceptNote>
          <MatchersEditor
            label="Source — while this is firing"
            value={source}
            onChange={setSource}
          />
          <MatchersEditor
            label="Target — suppress these"
            value={target}
            onChange={setTarget}
          />
          <div className="space-y-1.5">
            <Label htmlFor="inhibition-equal">
              Equal labels{" "}
              <span className="font-normal text-muted-foreground">
                (comma-separated)
              </span>
            </Label>
            <Input
              id="inhibition-equal"
              className="font-mono"
              value={equal}
              onChange={(e) => setEqual(e.target.value)}
              placeholder="cluster, namespace"
            />
          </div>
          <PreviewLine>
            While an alert matching <strong>{matchersPhrase(source)}</strong> is
            firing, suppress alerts matching{" "}
            <strong>{matchersPhrase(target)}</strong>
            {equalLabels.length > 0 ? (
              <>
                {" "}
                that share <strong>{equalLabels.join(", ")}</strong>
              </>
            ) : null}
            .
          </PreviewLine>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            Create inhibition
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────

function ReceiversSection() {
  const { data, isPending, isError, error } = useQuery(q.receivers());
  return (
    <Card id="receivers" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Receivers</CardTitle>
        <CardDescription>
          The channels alerts can be delivered to. Defined as code with{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem]">
            everr apply
          </code>{" "}
          — secrets are redacted here.
        </CardDescription>
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
            hint="Define Slack, webhook, PagerDuty, or email channels as code, then apply them."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((r) => {
              const Icon = CHANNEL_ICON[r.channel.type];
              return (
                <li
                  key={r.name}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{r.name}</div>
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
      </CardContent>
    </Card>
  );
}

function RoutesSection({ receivers }: { receivers: CcReceiver[] }) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(q.routes());
  const [open, setOpen] = useState(false);

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
          <Button onClick={() => setOpen(true)}>
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
            {sorted.map((r: CcRoute) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="w-8 shrink-0 text-center font-mono text-xs text-muted-foreground tabular-nums">
                  #{r.priority}
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <Matchers matchers={r.matchers} emptyLabel="any alert" />
                  <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                  <span className="font-mono text-xs">{r.receiver}</span>
                </div>
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
            ))}
          </ul>
        )}
      </CardContent>
      <RouteBuilder open={open} onOpenChange={setOpen} receivers={receivers} />
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
  const [url, setUrl] = useState("");
  const create = useMutation({
    mutationFn: () => createCcSubscription({ data: { webhookUrl: url } }),
    onSuccess: (s) => {
      toast.success(`Subscription created (${s.id.slice(0, 8)})`);
      setUrl("");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <Card id="firehose" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Firehose subscriptions</CardTitle>
        <CardDescription>
          The fallback: alerts that match no route are delivered to every
          firehose webhook. CC exposes create only — existing subscriptions
          can&rsquo;t be listed or removed here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex items-end gap-2"
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
