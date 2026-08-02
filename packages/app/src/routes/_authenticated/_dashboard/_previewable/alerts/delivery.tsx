// The Delivery page: routes rendered as the flow the dispatcher walks
// (matchers → receiver → channels, firehose fallback last), with a label-set
// preview that evaluates the dispatcher's real matching semantics against it.
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
} from "@everr/ui/components/collapsible";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import {
  ArrowRight,
  BellMinus,
  CornerDownRight,
  Inbox,
  type LucideIcon,
  Pencil,
  Plus,
  Trash2,
  Webhook,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { isEverrAnnotationKey } from "@/data/alerts/annotations";
import { ccQueries } from "@/data/cc/queries";
import { ccDispatchLabels, ccSelectRoutes } from "@/data/cc/route-resolution";
import { ccRouteTimingSummary } from "@/data/cc/route-timing";
import {
  createCcSubscription,
  deleteCcChannel,
  deleteCcInhibition,
  deleteCcReceiver,
  deleteCcRoute,
  deleteCcSubscription,
} from "@/data/cc/server";
import type {
  CcChannel,
  CcInhibition,
  CcReceiver,
  CcRoute,
} from "@/data/cc/types";
import { ChannelBuilder } from "./-components/channel-builder";
import { CHANNEL_ICON, channelTarget } from "./-components/channel-meta";
import { InhibitionBuilder } from "./-components/inhibition-builder";
import { CcPageIntro } from "./-components/page-intro";
import { ReceiverBuilder } from "./-components/receiver-builder";
import { RouteBuilder } from "./-components/route-builder";
import { ChannelChip, RoutePreview } from "./-components/route-preview";
import {
  CcDisclosureTrigger,
  CcEmptyState,
  CcQueryError,
  CcTableSkeleton,
  Conditions,
  ccErrorMessage,
  ccFormatTs,
} from "./-components/shared";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/delivery",
)({
  staticData: { breadcrumb: "Delivery" },
  head: () => ({ meta: [{ title: "Everr - Alerting Delivery" }] }),
  loaderDeps: ({ search: { preview } }) => ({ preview }),
  loader: ({ context: { queryClient }, deps }) =>
    Promise.all([
      queryClient.prefetchQuery(ccQueries.routes()),
      queryClient.prefetchQuery(ccQueries.receivers()),
      queryClient.prefetchQuery(ccQueries.channels()),
      queryClient.prefetchQuery(ccQueries.inhibitions()),
      queryClient.prefetchQuery(ccQueries.alerts(deps.preview)),
      queryClient.prefetchQuery(ccQueries.rules()),
      queryClient.prefetchQuery(ccQueries.slos(deps.preview)),
      queryClient.prefetchQuery(ccQueries.subscriptions()),
    ]),
  component: CcDeliveryPage,
});

// ── Section body cascade ──────────────────────────────────────────────────────
// Every section on this page renders the same way: query error, then loading
// skeleton, then (optionally) an empty state, then the loaded content.

function SectionBody({
  isError,
  error,
  isPending,
  skeletonRows,
  empty,
  errorClassName = "px-3 pb-3",
  children,
}: {
  isError: boolean;
  error: unknown;
  isPending: boolean;
  skeletonRows: number;
  /** Empty state, shown instead of children; omit to always render children. */
  empty?: { when: boolean; icon: LucideIcon; title: string; hint: string };
  errorClassName?: string;
  children: React.ReactNode;
}) {
  if (isError) {
    return (
      <div className={errorClassName}>
        <CcQueryError error={error} />
      </div>
    );
  }
  if (isPending) return <CcTableSkeleton rows={skeletonRows} />;
  if (empty?.when) {
    return (
      <CcEmptyState icon={empty.icon} title={empty.title} hint={empty.hint} />
    );
  }
  return <>{children}</>;
}

// ── Live pipeline ─────────────────────────────────────────────────────────────
// While the preview is active, the matched route chain lights up and the rest
// dims.

function PipelineRoute({
  route,
  receiver,
  channelsByName,
  previewActive,
  matched,
  onEdit,
  onDelete,
  deletePending,
}: {
  route: CcRoute;
  receiver: CcReceiver | undefined;
  channelsByName: Map<string, CcChannel>;
  previewActive: boolean;
  matched: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deletePending: boolean;
}) {
  // Custom timing only: routes on engine defaults keep a single-line row.
  const timing = ccRouteTimingSummary(
    {
      groupBy: route.group_by,
      groupWaitSecs: route.group_wait_secs,
      groupIntervalSecs: route.group_interval_secs,
      repeatIntervalSecs: route.repeat_interval_secs,
    },
    "overrides",
  );
  return (
    <li
      data-matched={previewActive && matched ? "true" : undefined}
      className={cn(
        "flex items-start gap-3 px-3 py-2 transition-opacity duration-200",
        previewActive &&
          (matched
            ? "bg-primary/5 ring-1 ring-primary/40 ring-inset"
            : "opacity-40"),
      )}
    >
      <span className="w-8 shrink-0 pt-0.5 text-center font-mono text-xs text-muted-foreground tabular-nums">
        #{route.priority}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Conditions matchers={route.matchers} emptyLabel="any alert" />
          <ArrowRight
            aria-hidden
            className={cn(
              "size-3.5 shrink-0",
              previewActive && matched
                ? "text-primary"
                : "text-muted-foreground/60",
            )}
          />
          <span className="font-mono text-xs font-medium text-foreground">
            {route.receiver}
          </span>
          <ArrowRight
            aria-hidden
            className={cn(
              "size-3.5 shrink-0",
              previewActive && matched
                ? "text-primary"
                : "text-muted-foreground/60",
            )}
          />
          {receiver ? (
            receiver.channels.map((name) => (
              <ChannelChip
                key={name}
                name={name}
                channel={channelsByName.get(name)}
                emphasized={previewActive && matched}
                missingLabel="missing"
              />
            ))
          ) : (
            <span className={`text-xs ${toneText({ tone: "warning" })}`}>
              receiver not found
            </span>
          )}
          {route.continue && (
            <span
              title="This route keeps matching: later routes are checked too"
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/20 px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none text-muted-foreground"
            >
              continue
              <CornerDownRight aria-hidden className="size-3" />
            </span>
          )}
          {previewActive && matched && (
            <span className="font-mono text-[0.6875rem] text-primary">
              matched
            </span>
          )}
        </div>
        {timing.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {timing.join(" · ")}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Edit route"
        onClick={onEdit}
      >
        <Pencil />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete route"
        disabled={deletePending}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </li>
  );
}

function PipelineSection({
  receivers,
  channelsByName,
  previewLabels,
  matchedRouteIds,
  subscriberCount,
  onFirehoseClick,
}: {
  receivers: CcReceiver[];
  channelsByName: Map<string, CcChannel>;
  /** Preview label set; empty object = preview inactive. */
  previewLabels: Record<string, string>;
  /** Ids of the routes ccSelectRoutes picked for the preview labels. */
  matchedRouteIds: Set<string>;
  subscriberCount: number;
  onFirehoseClick: () => void;
}) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(ccQueries.routes());
  const [editing, setEditing] = useState<CcRoute | "new" | null>(null);
  const receiversByName = useMemo(
    () => new Map(receivers.map((r) => [r.name, r])),
    [receivers],
  );

  const remove = useMutation({
    mutationFn: (id: string) => deleteCcRoute({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ccQueries.routes().queryKey });
      toast.success("Route deleted");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const previewActive = Object.keys(previewLabels).length > 0;
  const sorted = [...(data ?? [])].sort((a, b) => a.priority - b.priority);
  const fellThrough = previewActive && matchedRouteIds.size === 0;

  return (
    <Card id="routes" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Delivery pipeline</CardTitle>
        <CardDescription>
          Routes are checked top to bottom; the first match decides, unless it
          continues.
        </CardDescription>
        <CardAction>
          <Button onClick={() => setEditing("new")}>
            <Plus data-icon="inline-start" />
            New route
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <SectionBody
          isError={isError}
          error={error}
          isPending={isPending}
          skeletonRows={3}
        >
          <ul className="divide-y divide-border/60">
            {sorted.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                No routes yet: every alert is delivered to all firehose
                subscriptions below.
              </li>
            )}
            {sorted.map((r) => (
              <PipelineRoute
                key={r.id}
                route={r}
                receiver={receiversByName.get(r.receiver)}
                channelsByName={channelsByName}
                previewActive={previewActive}
                matched={matchedRouteIds.has(r.id)}
                onEdit={() => setEditing(r)}
                onDelete={() => remove.mutate(r.id)}
                deletePending={remove.isPending}
              />
            ))}
            {/* Terminal node: the engine's fallback when no route matches. */}
            <li
              data-matched={fellThrough ? "true" : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2 transition-opacity duration-200",
                previewActive &&
                  (fellThrough
                    ? "bg-primary/5 ring-1 ring-primary/40 ring-inset"
                    : "opacity-40"),
              )}
            >
              <span
                aria-hidden
                className="w-8 shrink-0 text-center font-mono text-xs text-muted-foreground"
              >
                ∅
              </span>
              <span className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">no match</span>
                <ArrowRight
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0",
                    fellThrough ? "text-primary" : "text-muted-foreground/60",
                  )}
                />
                <button
                  type="button"
                  onClick={onFirehoseClick}
                  className="font-mono text-foreground underline-offset-2 outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:underline focus-visible:outline-primary"
                >
                  firehose
                </button>
                <span
                  className={cn(
                    "font-mono",
                    toneText({
                      tone: subscriberCount === 0 ? "warning" : "muted",
                    }),
                  )}
                >
                  ·{" "}
                  {subscriberCount === 0
                    ? "no subscribers"
                    : `${subscriberCount} webhook${subscriberCount === 1 ? "" : "s"}`}
                </span>
                {fellThrough && (
                  <span className="font-mono text-[0.6875rem] text-primary">
                    matched
                  </span>
                )}
              </span>
            </li>
          </ul>
        </SectionBody>
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

// ── Address book ──────────────────────────────────────────────────────────────

function ReceiversSection({ channels }: { channels: CcChannel[] }) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(ccQueries.receivers());
  const [open, setOpen] = useState(false);
  const channelsByName = useMemo(
    () => new Map(channels.map((c) => [c.name, c])),
    [channels],
  );

  const remove = useMutation({
    mutationFn: (name: string) => deleteCcReceiver({ data: { name } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ccQueries.receivers().queryKey });
      toast.success("Receiver deleted");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <Card id="receivers" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Receivers</CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus data-icon="inline-start" />
            New receiver
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <SectionBody
          isError={isError}
          error={error}
          isPending={isPending}
          skeletonRows={3}
          empty={{
            when: (data ?? []).length === 0,
            icon: Inbox,
            title: "No receivers defined",
            hint: "Add a receiver that references one or more channels for routes to deliver alerts to.",
          }}
        >
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((r) => {
              const resolved = r.channels.map((name) => ({
                name,
                channel: channelsByName.get(name),
              }));
              const Icon =
                CHANNEL_ICON[resolved[0]?.channel?.config.type ?? "webhook"];
              // Minus `everr.`-prefixed internal markers (stamped by older
              // flows; not user metadata).
              const customAnnotations = Object.entries(
                r.annotations ?? {},
              ).filter(([k]) => !isEverrAnnotationKey(k));
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
                    {resolved.map(({ name, channel }) => (
                      <div
                        key={name}
                        className="truncate font-mono text-xs text-muted-foreground"
                      >
                        {name}
                        {channel ? ` (${channel.config.type})` : ""}
                      </div>
                    ))}
                    {customAnnotations.length > 0 && (
                      <div className="truncate text-xs text-muted-foreground">
                        {customAnnotations
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(", ")}
                      </div>
                    )}
                  </div>
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
        </SectionBody>
      </CardContent>
      <ReceiverBuilder
        key={open ? "open" : "closed"}
        open={open}
        onOpenChange={setOpen}
        existingNames={(data ?? []).map((r) => r.name)}
        channels={channels}
      />
    </Card>
  );
}

function ChannelsSection() {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(ccQueries.channels());
  const [open, setOpen] = useState(false);

  const remove = useMutation({
    mutationFn: (name: string) => deleteCcChannel({ data: { name } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ccQueries.channels().queryKey });
      toast.success("Channel deleted");
    },
    // A referenced channel deletes with a 409 naming the referring receivers;
    // the engine's message is surfaced verbatim.
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <Card id="channels" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Channels</CardTitle>
        <CardDescription>Secrets are redacted on read.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus data-icon="inline-start" />
            New channel
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <SectionBody
          isError={isError}
          error={error}
          isPending={isPending}
          skeletonRows={3}
          empty={{
            when: (data ?? []).length === 0,
            icon: Inbox,
            title: "No channels defined",
            hint: "Add a Slack, webhook, email, or Telegram endpoint for receivers to deliver through.",
          }}
        >
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((c) => {
              const Icon = CHANNEL_ICON[c.config.type];
              return (
                <li
                  key={c.name}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{c.name}</span>
                    </div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {channelTarget(c.config) || c.config.type}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {c.config.type}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete channel"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(c.name)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        </SectionBody>
      </CardContent>
      <ChannelBuilder
        key={open ? "open" : "closed"}
        open={open}
        onOpenChange={setOpen}
        existingNames={(data ?? []).map((c) => c.name)}
      />
    </Card>
  );
}

// ── Advanced delivery ─────────────────────────────────────────────────────────

function InhibitionsSection() {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(ccQueries.inhibitions());
  const [open, setOpen] = useState(false);

  const remove = useMutation({
    mutationFn: (id: string) => deleteCcInhibition({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ccQueries.inhibitions().queryKey });
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
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus data-icon="inline-start" />
            New inhibition
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <SectionBody
          isError={isError}
          error={error}
          isPending={isPending}
          skeletonRows={2}
          empty={{
            when: (data ?? []).length === 0,
            icon: BellMinus,
            title: "No inhibition rules",
            hint: "Add a rule to mute downstream alerts while a higher-level alert is already firing.",
          }}
        >
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((r: CcInhibition) => (
              <li
                key={r.id}
                className="flex items-start gap-3 px-3 py-2.5 text-xs leading-relaxed"
              >
                <div className="min-w-0 flex-1">
                  While{" "}
                  <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                    <Conditions matchers={r.source_matchers} />
                  </span>{" "}
                  fires, suppress{" "}
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
                  aria-label="Delete inhibition"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(r.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        </SectionBody>
      </CardContent>
      <InhibitionBuilder open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function FirehoseSection() {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(
    ccQueries.subscriptions(),
  );
  const [url, setUrl] = useState("");

  const create = useMutation({
    mutationFn: () => createCcSubscription({ data: { webhookUrl: url } }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ccQueries.subscriptions().queryKey });
      toast.success(`Subscription created (${s.id.slice(0, 8)})`);
      setUrl("");
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCcSubscription({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ccQueries.subscriptions().queryKey });
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
        <SectionBody
          isError={isError}
          error={error}
          isPending={isPending}
          skeletonRows={2}
          errorClassName="px-3"
          empty={{
            when: (data ?? []).length === 0,
            icon: Webhook,
            title: "No firehose subscriptions",
            hint: "Add a webhook URL below to receive every alert that matches no route.",
          }}
        >
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Webhook className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    Firehose webhook
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
        </SectionBody>
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

// ── Page ──────────────────────────────────────────────────────────────────────

function CcDeliveryPage() {
  const location = useLocation();
  const { preview } = Route.useSearch();
  const routes = useQuery(ccQueries.routes());
  const receivers = useQuery(ccQueries.receivers());
  const channels = useQuery(ccQueries.channels());
  const alerts = useQuery(ccQueries.alerts(preview));
  const rules = useQuery(ccQueries.rules());
  const slos = useQuery(ccQueries.slos(preview));
  const subscriptions = useQuery(ccQueries.subscriptions());

  // The preview's label set; {} = inactive.
  const [previewLabels, setPreviewLabels] = useState<Record<string, string>>(
    {},
  );
  // Deep links (#firehose, #inhibitions) land inside the collapsed Advanced
  // section, so those hashes open it from the start.
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    ["firehose", "inhibitions"].includes(location.hash),
  );

  const matchedRoutes = useMemo(
    () =>
      Object.keys(previewLabels).length > 0
        ? ccSelectRoutes(routes.data ?? [], previewLabels)
        : [],
    [routes.data, previewLabels],
  );
  const matchedRouteIds = useMemo(
    () => new Set(matchedRoutes.map((r) => r.id)),
    [matchedRoutes],
  );

  // Prefill: the dispatch-time (synthetic) label set of a currently-firing
  // instance, when one exists. SLO-sourced instances resolve their SLO
  // (severity from the burn-rate tier, plus the synthetic `slo` label);
  // rule-sourced ones their rule.
  const prefill = useMemo(() => {
    const firing = (alerts.data ?? []).find((a) => a.status === "firing");
    if (!firing) return null;
    const slo =
      firing.slo !== undefined
        ? (slos.data ?? []).find((s) => s.id === firing.slo)
        : undefined;
    const rule =
      firing.slo === undefined
        ? (rules.data ?? []).find((r) => r.id === firing.rule)
        : undefined;
    return ccDispatchLabels(firing, rule, slo);
  }, [alerts.data, rules.data, slos.data]);

  const receiversByName = useMemo(
    () => new Map((receivers.data ?? []).map((r) => [r.name, r])),
    [receivers.data],
  );
  const channelsByName = useMemo(
    () => new Map((channels.data ?? []).map((c) => [c.name, c])),
    [channels.data],
  );
  const subscriberCount = (subscriptions.data ?? []).length;

  return (
    <div className="space-y-3">
      <CcPageIntro
        title="Delivery"
        lede="Who gets told about a firing alert, and how: routes match alerts to receivers, receivers fan out to channels."
        docsHref="https://everr.dev/docs/guides/set-up-notifications"
      />

      <PipelineSection
        receivers={receivers.data ?? []}
        channelsByName={channelsByName}
        previewLabels={previewLabels}
        matchedRouteIds={matchedRouteIds}
        subscriberCount={subscriberCount}
        onFirehoseClick={() => {
          setAdvancedOpen(true);
          // Next frame: the section must exist before it can be scrolled to.
          requestAnimationFrame(() => {
            document
              .getElementById("firehose")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Route preview</CardTitle>
          <CardDescription>
            Evaluates a label set against the pipeline above with the
            dispatcher&rsquo;s exact matching rules.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RoutePreview
            labels={previewLabels}
            onLabelsChange={setPreviewLabels}
            matchedRoutes={matchedRoutes}
            receiversByName={receiversByName}
            channelsByName={channelsByName}
            subscriberCount={subscriberCount}
            prefill={prefill}
          />
        </CardContent>
      </Card>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <ReceiversSection channels={channels.data ?? []} />
        <ChannelsSection />
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CcDisclosureTrigger open={advancedOpen} className="bg-card">
          <span className="text-xs font-medium">Advanced delivery</span>
          <span className="text-xs text-muted-foreground">
            inhibitions · firehose subscriptions
          </span>
        </CcDisclosureTrigger>
        <CollapsibleContent>
          <div className="space-y-3 pt-3">
            <InhibitionsSection />
            <FirehoseSection />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
