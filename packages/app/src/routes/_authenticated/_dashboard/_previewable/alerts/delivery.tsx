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
  Check,
  CornerDownRight,
  Inbox,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ccQueries } from "@/data/cc/queries";
import {
  ccDispatchLabels,
  ccSelectRoutes,
  ccUnmatchedOutcome,
} from "@/data/cc/route-resolution";
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
import {
  CHANNEL_ICON,
  CHANNEL_LABEL,
  type ChannelIcon,
  channelTarget,
} from "./-components/channel-meta";
import { InhibitionBuilder } from "./-components/inhibition-builder";
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

const WebhookGlyph = CHANNEL_ICON.webhook;

// Derived from the channel registry so the empty state never advertises a
// stale menu of types.
const CHANNEL_KIND_LIST = new Intl.ListFormat("en", {
  type: "disjunction",
}).format(Object.values(CHANNEL_LABEL));

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
  empty?: { when: boolean; icon: ChannelIcon; title: string; hint: string };
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
  // Custom timing only: routes on engine defaults stay single-line.
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

function FallThroughRow({
  outcome,
  previewActive,
  fellThrough,
  subscriberCount,
  onFirehoseClick,
}: {
  outcome: "firehose" | "dropped";
  previewActive: boolean;
  /** The preview labels matched no route, so they land on this row. */
  fellThrough: boolean;
  subscriberCount: number;
  onFirehoseClick: () => void;
}) {
  return (
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
        {outcome === "firehose" ? (
          <>
            <button
              type="button"
              onClick={onFirehoseClick}
              className="font-mono text-foreground underline-offset-2 outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:underline focus-visible:outline-primary"
            >
              fallback webhooks
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
                ? "none configured"
                : `${subscriberCount} configured`}
            </span>
            {fellThrough && (
              <span className="font-mono text-[0.6875rem] text-primary">
                matched
              </span>
            )}
          </>
        ) : (
          <>
            <span className={cn("font-mono", toneText({ tone: "warning" }))}>
              not delivered
            </span>
            <span className="text-muted-foreground">
              · add a catch-all route (no conditions) to set a default receiver
            </span>
          </>
        )}
      </span>
    </li>
  );
}

/**
 * The one-time path from nothing to a working pipeline. Rendered in place of
 * the route list while no route exists; the dependency order (channel, then
 * receiver, then route) is the information the numbers carry.
 */
function SetupStep({
  index,
  done,
  title,
  detail,
  action,
  onAction,
}: {
  index: number;
  done: boolean;
  title: string;
  detail: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs",
          done
            ? "border-transparent bg-muted text-muted-foreground"
            : "border-border text-foreground",
        )}
      >
        {done ? <Check aria-hidden className="size-3.5" /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cn("text-sm font-medium", done && "text-muted-foreground")}
        >
          {title}
        </div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      {!done && (
        <Button variant="outline" size="sm" onClick={onAction}>
          {action}
        </Button>
      )}
    </li>
  );
}

function SetupChecklist({
  channelCount,
  receiverCount,
  subscriberCount,
  onAddChannel,
  onAddReceiver,
  onAddRoute,
}: {
  channelCount: number;
  receiverCount: number;
  subscriberCount: number;
  onAddChannel: () => void;
  onAddReceiver: () => void;
  onAddRoute: () => void;
}) {
  return (
    <>
      <li className="px-3 py-2.5">
        <div className="text-sm font-medium">Set up delivery</div>
        <p className="max-w-prose text-xs text-muted-foreground">
          {subscriberCount === 0
            ? "Alerts are evaluated and recorded in history, but delivered to no one until a route exists."
            : "Until a route exists, every alert is delivered to the fallback webhooks under Advanced delivery."}
        </p>
      </li>
      <SetupStep
        index={1}
        done={channelCount > 0}
        title="Add a channel"
        detail="The endpoint notifications are sent to: a webhook, Slack, email, or Telegram."
        action="Add channel"
        onAction={onAddChannel}
      />
      <SetupStep
        index={2}
        done={receiverCount > 0}
        title="Create a receiver"
        detail="A named group of channels for routes to deliver to."
        action="Add receiver"
        onAction={onAddReceiver}
      />
      <SetupStep
        index={3}
        done={false}
        title="Route alerts to it"
        detail="Conditions pick which alerts it receives; a route with no conditions matches every alert."
        action="Add route"
        onAction={onAddRoute}
      />
    </>
  );
}

function PipelineSection({
  receivers,
  channelsByName,
  previewLabels,
  onPreviewLabelsChange,
  matchedRoutes,
  prefill,
  subscriberCount,
  onFirehoseClick,
  onAddChannel,
  onAddReceiver,
}: {
  receivers: CcReceiver[];
  channelsByName: Map<string, CcChannel>;
  /** Preview label set; empty object = preview inactive. */
  previewLabels: Record<string, string>;
  onPreviewLabelsChange: (labels: Record<string, string>) => void;
  /** ccSelectRoutes(...) result for the preview labels. */
  matchedRoutes: CcRoute[];
  /** A firing instance's dispatch-time label set, for preview prefill. */
  prefill: Record<string, string> | null;
  subscriberCount: number;
  onFirehoseClick: () => void;
  /** Open the create drawers owned by the sibling cards (setup checklist). */
  onAddChannel: () => void;
  onAddReceiver: () => void;
}) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(ccQueries.routes());
  const [editing, setEditing] = useState<CcRoute | "new" | null>(null);
  const receiversByName = useMemo(
    () => new Map(receivers.map((r) => [r.name, r])),
    [receivers],
  );
  const matchedRouteIds = useMemo(
    () => new Set(matchedRoutes.map((r) => r.id)),
    [matchedRoutes],
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
  const unmatched = ccUnmatchedOutcome(sorted);

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
        {/* The preview evaluates the list below it, so it lives in the same
            card: typed labels dim non-matching rows in place. */}
        <div className="border-b border-border/60 px-3 pb-3">
          <RoutePreview
            labels={previewLabels}
            onLabelsChange={onPreviewLabelsChange}
            matchedRoutes={matchedRoutes}
            routeCount={(data ?? []).length}
            receiversByName={receiversByName}
            channelsByName={channelsByName}
            subscriberCount={subscriberCount}
            prefill={prefill}
          />
        </div>
        <SectionBody
          isError={isError}
          error={error}
          isPending={isPending}
          skeletonRows={3}
        >
          <ul className="divide-y divide-border/60">
            {sorted.length === 0 && (
              <SetupChecklist
                channelCount={channelsByName.size}
                receiverCount={receivers.length}
                subscriberCount={subscriberCount}
                onAddChannel={onAddChannel}
                onAddReceiver={onAddReceiver}
                onAddRoute={() => setEditing("new")}
              />
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
            {unmatched !== "unreachable" && (
              <FallThroughRow
                outcome={unmatched}
                previewActive={previewActive}
                fellThrough={fellThrough}
                subscriberCount={subscriberCount}
                onFirehoseClick={onFirehoseClick}
              />
            )}
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

function ReceiversSection({
  channels,
  routes,
  editing,
  onEditingChange,
}: {
  channels: CcChannel[];
  /** For per-receiver usage facts; undefined while the routes query loads. */
  routes: CcRoute[] | undefined;
  /** Lifted so the pipeline's setup checklist can open the create drawer. */
  editing: CcReceiver | "new" | null;
  onEditingChange: (editing: CcReceiver | "new" | null) => void;
}) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(ccQueries.receivers());
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEditingChange("new")}
          >
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
              // A receiver no route targets never gets an alert: the one
              // misconfiguration this list can catch, so say it loudly.
              const targeting = routes?.filter(
                (rt) => rt.receiver === r.name,
              ).length;
              return (
                <li key={r.name} className="flex items-start gap-3 px-3 py-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Inbox className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{r.name}</span>
                      {targeting !== undefined &&
                        (targeting === 0 ? (
                          <span
                            className={cn(
                              "text-xs",
                              toneText({ tone: "warning" }),
                            )}
                          >
                            no route targets this receiver
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {targeting} {targeting === 1 ? "route" : "routes"}
                          </span>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {r.channels.map((name) => (
                        <ChannelChip
                          key={name}
                          name={name}
                          channel={channelsByName.get(name)}
                          missingLabel="missing"
                        />
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Edit receiver"
                    onClick={() => onEditingChange(r)}
                  >
                    <Pencil />
                  </Button>
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
        key={editing === "new" ? "new" : (editing?.name ?? "closed")}
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) onEditingChange(null);
        }}
        existingNames={(data ?? []).map((r) => r.name)}
        channels={channels}
        receiver={editing === "new" ? null : editing}
      />
    </Card>
  );
}

function ChannelsSection({
  receivers,
  editing,
  onEditingChange,
}: {
  /** For per-channel usage facts; undefined while the receivers query loads. */
  receivers: CcReceiver[] | undefined;
  /** Lifted so the pipeline's setup checklist can open the create drawer. */
  editing: CcChannel | "new" | null;
  onEditingChange: (editing: CcChannel | "new" | null) => void;
}) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(ccQueries.channels());

  const remove = useMutation({
    mutationFn: (name: string) => deleteCcChannel({ data: { name } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ccQueries.channels().queryKey });
      toast.success("Channel deleted");
    },
    // Deleting a referenced channel 409s naming the referring receivers; the
    // engine's message is surfaced verbatim.
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <Card id="channels" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Channels</CardTitle>
        <CardDescription>Secrets are redacted on read.</CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEditingChange("new")}
          >
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
            hint: `Add a ${CHANNEL_KIND_LIST} endpoint for receivers to deliver through.`,
          }}
        >
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((c) => {
              const Icon = CHANNEL_ICON[c.config.type];
              // "***" is the engine's redaction for secret targets; showing it
              // told the reader nothing, so the subline carries usage instead.
              const target = channelTarget(c.config);
              const usedBy = receivers?.filter((r) =>
                r.channels.includes(c.name),
              ).length;
              return (
                <li
                  key={c.name}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{c.name}</span>
                    </div>
                    {target !== "" && target !== "***" && (
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {target}
                      </div>
                    )}
                    {usedBy !== undefined &&
                      (usedBy === 0 ? (
                        <div
                          className={cn(
                            "text-xs",
                            toneText({ tone: "warning" }),
                          )}
                        >
                          not referenced by any receiver
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          {usedBy} {usedBy === 1 ? "receiver" : "receivers"}
                        </div>
                      ))}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {c.config.type}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Edit channel"
                    onClick={() => onEditingChange(c)}
                  >
                    <Pencil />
                  </Button>
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
        key={editing === "new" ? "new" : (editing?.name ?? "closed")}
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) onEditingChange(null);
        }}
        existingNames={(data ?? []).map((c) => c.name)}
        channel={editing === "new" ? null : editing}
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
        <CardTitle>Fallback webhooks</CardTitle>
        <CardDescription>
          While the organization has no routes at all, every alert is delivered
          to every webhook listed here. Once any route exists, alerts that match
          no route are not delivered.
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
            icon: WebhookGlyph,
            title: "No fallback webhooks",
            hint: "Add a webhook URL below to receive every alert while no routes exist.",
          }}
        >
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <WebhookGlyph className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    Fallback webhook
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
  // Create/edit drawer state for receivers and channels lives here so the
  // pipeline's setup checklist can open the create drawers directly.
  const [receiverEditing, setReceiverEditing] = useState<
    CcReceiver | "new" | null
  >(null);
  const [channelEditing, setChannelEditing] = useState<
    CcChannel | "new" | null
  >(null);
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

  // SLO-sourced instances resolve their SLO (severity from the burn-rate
  // tier, plus the synthetic `slo` label); rule-sourced ones their rule.
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

  const channelsByName = useMemo(
    () => new Map((channels.data ?? []).map((c) => [c.name, c])),
    [channels.data],
  );
  const subscriberCount = (subscriptions.data ?? []).length;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Delivery"
        lede="Who gets told about a firing alert, and how: routes match alerts to receivers, receivers fan out to channels."
        docsHref="https://everr.dev/docs/guides/set-up-notifications"
      />

      <PipelineSection
        receivers={receivers.data ?? []}
        channelsByName={channelsByName}
        previewLabels={previewLabels}
        onPreviewLabelsChange={setPreviewLabels}
        matchedRoutes={matchedRoutes}
        prefill={prefill}
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
        onAddChannel={() => setChannelEditing("new")}
        onAddReceiver={() => setReceiverEditing("new")}
      />

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <ReceiversSection
          channels={channels.data ?? []}
          routes={routes.data}
          editing={receiverEditing}
          onEditingChange={setReceiverEditing}
        />
        <ChannelsSection
          receivers={receivers.data}
          editing={channelEditing}
          onEditingChange={setChannelEditing}
        />
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CcDisclosureTrigger open={advancedOpen} className="bg-card">
          <span className="text-xs font-medium">Advanced delivery</span>
          <span className="text-xs text-muted-foreground">
            inhibitions · fallback webhooks
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
