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
import { Switch } from "@everr/ui/components/switch";
import { TagsInput } from "@everr/ui/components/tags-input";
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
  deleteCcSubscription,
  listCcAlerts,
  listCcInhibitions,
  listCcReceivers,
  listCcRoutes,
  listCcSilences,
  listCcSubscriptions,
  updateCcRoute,
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
  ccFormatTs,
  Matchers,
} from "./-cc-shared";

// Ownership markers the as-code receiver reconciler stamps (data/cc/apply.server.ts).
const RECEIVER_MANAGED_KEY = "everr.managed";
const RECEIVER_MANAGED_AS_CODE = "as-code";
const isAsCodeReceiver = (r: CcReceiver): boolean =>
  r.annotations?.[RECEIVER_MANAGED_KEY] === RECEIVER_MANAGED_AS_CODE;

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

function PreviewLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed [&_strong]:font-medium [&_strong]:text-foreground">
      {children}
    </div>
  );
}

// ── Route builder ─────────────────────────────────────────────────────────────

/** Parse a numeric duration field. Empty ⇒ null (CC default). */
function parseDuration(
  raw: string,
  min: number,
): { value: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null, error: null };
  if (!/^\d+$/.test(trimmed))
    return { value: null, error: "Must be a whole number" };
  const value = Number(trimmed);
  if (value < min)
    return { value: null, error: `Must be at least ${min} seconds` };
  return { value, error: null };
}

function DurationField({
  id,
  label,
  placeholder,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        className="tabular-nums"
        value={value}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function RouteBuilder({
  open,
  onOpenChange,
  receivers,
  route,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  receivers: CcReceiver[];
  route: CcRoute | null;
}) {
  const qc = useQueryClient();
  const isEdit = route !== null;
  const [matchers, setMatchers] = useState<CcMatcher[]>(route?.matchers ?? []);
  const [receiver, setReceiver] = useState(route?.receiver ?? "");
  const [priority, setPriority] = useState(route?.priority ?? 0);
  const [continueFlag, setContinueFlag] = useState(route?.continue ?? false);
  const [groupBy, setGroupBy] = useState<string[]>(route?.group_by ?? []);
  const [groupWait, setGroupWait] = useState(
    route?.group_wait_secs != null ? String(route.group_wait_secs) : "",
  );
  const [groupInterval, setGroupInterval] = useState(
    route?.group_interval_secs != null ? String(route.group_interval_secs) : "",
  );
  const [repeatInterval, setRepeatInterval] = useState(
    route?.repeat_interval_secs != null
      ? String(route.repeat_interval_secs)
      : "",
  );

  const wait = parseDuration(groupWait, 0);
  const interval = parseDuration(groupInterval, 0);
  const repeat = parseDuration(repeatInterval, 60);
  const hasErrors = !!(wait.error || interval.error || repeat.error);

  const save = useMutation({
    mutationFn: () => {
      const input = {
        matchers,
        receiver,
        continue: continueFlag,
        priority,
        group_by: groupBy.length > 0 ? groupBy : null,
        group_wait_secs: wait.value,
        group_interval_secs: interval.value,
        repeat_interval_secs: repeat.value,
      };
      return isEdit
        ? updateCcRoute({ data: { id: route.id, input } })
        : createCcRoute({ data: input });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cc", "routes"] });
      onOpenChange(false);
      toast.success(isEdit ? "Route updated" : "Route created");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit route" : "New route"}</DialogTitle>
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
          <div className="space-y-1.5">
            <Label htmlFor="route-group-by">
              Group by{" "}
              <span className="font-normal text-muted-foreground">
                (empty uses the default: rule, severity)
              </span>
            </Label>
            <TagsInput
              aria-label="Group by labels"
              placeholder="rule, severity"
              value={groupBy}
              onValueChange={setGroupBy}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <DurationField
              id="route-group-wait"
              label="Group wait (s)"
              placeholder="10"
              value={groupWait}
              onChange={setGroupWait}
              error={wait.error}
            />
            <DurationField
              id="route-group-interval"
              label="Group interval (s)"
              placeholder="300"
              value={groupInterval}
              onChange={setGroupInterval}
              error={interval.error}
            />
            <DurationField
              id="route-repeat-interval"
              label="Repeat interval (s)"
              placeholder="never"
              value={repeatInterval}
              onChange={setRepeatInterval}
              error={repeat.error}
            />
          </div>
          <Label className="flex items-center gap-2">
            <Switch checked={continueFlag} onCheckedChange={setContinueFlag} />
            Continue matching later routes
          </Label>
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
            disabled={!receiver || hasErrors || save.isPending}
            onClick={() => save.mutate()}
          >
            {isEdit ? "Save changes" : "Create route"}
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
          The channels alerts can be delivered to. Ones managed as code with{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.6875rem]">
            everr apply
          </code>{" "}
          are marked <span className="font-medium">as code</span>; secrets are
          redacted here. Receivers are not editable in the UI.
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
      </CardContent>
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
