import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@everr/ui/components/alert-dialog";
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
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BellMinus,
  Check,
  CheckCircle2,
  CornerDownRight,
  Inbox,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ccRuleIdentity } from "@/data/alerts/rule-identity";
import { ccQueries } from "@/data/cc/queries";
import {
  ccDispatchLabels,
  ccSelectRoutes,
  ccUnmatchedOutcome,
} from "@/data/cc/route-resolution";
import { ccRouteTimingSummary } from "@/data/cc/route-timing";
import {
  deleteCcChannel,
  deleteCcInhibition,
  deleteCcReceiver,
  deleteCcRoute,
  updateCcReceiver,
  updateCcRoute,
} from "@/data/cc/server";
import { ccSloIdentity } from "@/data/cc/slo";
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
import { RouteBuilder, routeOrderWarning } from "./-components/route-builder";
import { ChannelChip, RoutePreview } from "./-components/route-preview";
import {
  CcDisclosureTrigger,
  CcEmptyState,
  CcQueryError,
  CcTableSkeleton,
  Conditions,
  ccErrorMessage,
} from "./-components/shared";

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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <CardTitle>
      <h2>{children}</h2>
    </CardTitle>
  );
}

function ConfirmDeleteAction({
  label,
  title,
  description,
  confirmLabel,
  pending,
  details,
  confirmDisabledReason,
  blockedAction,
  onConfirm,
}: {
  label: string;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  pending: boolean;
  details?: React.ReactNode;
  confirmDisabledReason?: string;
  blockedAction?: { label: string; onClick: () => void };
  onConfirm: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const setDialogOpen = (nextOpen: boolean) => {
    if (pending) return;
    if (nextOpen) setFailure(null);
    setOpen(nextOpen);
  };

  const confirm = async () => {
    setFailure(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (error) {
      setFailure(ccErrorMessage(error));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setDialogOpen}>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-10 text-muted-foreground hover:text-destructive sm:size-8"
            aria-label={label}
            disabled={pending}
          />
        }
      >
        <Trash2 />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {details}
        {confirmDisabledReason && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs",
              toneText({ tone: "warning" }),
            )}
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <p>{confirmDisabledReason}</p>
          </div>
        )}
        {failure && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <div>
              <p className="font-medium">Deletion did not finish</p>
              <p className="mt-0.5 opacity-80">{failure}</p>
              <p className="mt-1 text-muted-foreground">
                Review the current configuration before trying again.
              </p>
            </div>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {confirmDisabledReason ? "Close" : "Cancel"}
          </AlertDialogCancel>
          {confirmDisabledReason ? (
            blockedAction && (
              <AlertDialogAction
                onClick={() => {
                  setOpen(false);
                  requestAnimationFrame(blockedAction.onClick);
                }}
              >
                {blockedAction.label}
              </AlertDialogAction>
            )
          ) : (
            <AlertDialogAction
              variant="destructive"
              aria-busy={pending}
              disabled={pending}
              onClick={confirm}
            >
              {pending && (
                <LoaderCircle
                  aria-hidden
                  className="motion-safe:animate-spin"
                />
              )}
              {pending ? "Deleting..." : confirmLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteOperations({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/20 p-3 text-xs">
      <div className="font-medium text-foreground">Changes</div>
      <ol className="list-decimal space-y-1 pl-4 text-muted-foreground marker:text-muted-foreground/70">
        {children}
      </ol>
    </div>
  );
}

function routeInput(route: CcRoute, priority = route.priority) {
  return {
    matchers: route.matchers,
    receiver: route.receiver,
    continue: route.continue,
    priority,
    group_by: route.group_by,
    group_wait_secs: route.group_wait_secs,
    group_interval_secs: route.group_interval_secs,
    repeat_interval_secs: route.repeat_interval_secs,
  };
}

// ── Live pipeline ─────────────────────────────────────────────────────────────

function PipelineRoute({
  route,
  position,
  routeCount,
  receiver,
  channelsByName,
  previewActive,
  matched,
  warning,
  connectTop,
  connectBottom,
  onMoveUp,
  onMoveDown,
  onEdit,
  onInsertAfter,
  onDelete,
  reorderPending,
  deletePending,
  actionsDisabled,
}: {
  route: CcRoute;
  position: number;
  routeCount: number;
  receiver: CcReceiver | undefined;
  channelsByName: Map<string, CcChannel>;
  previewActive: boolean;
  matched: boolean;
  warning?: string;
  connectTop: boolean;
  connectBottom: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onInsertAfter?: () => void;
  onDelete: () => Promise<unknown>;
  reorderPending: boolean;
  deletePending: boolean;
  actionsDisabled: boolean;
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
  const actions = (
    <div className="col-start-2 row-start-2 flex shrink-0 items-center gap-0.5 sm:col-start-3 sm:row-start-1">
      <Button
        variant="ghost"
        size="icon-lg"
        className="size-10 sm:size-8"
        aria-label={`Move route ${position} up`}
        title="Move route up"
        disabled={position === 1 || reorderPending || actionsDisabled}
        onClick={onMoveUp}
      >
        <ArrowUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        className="size-10 sm:size-8"
        aria-label={`Move route ${position} down`}
        title="Move route down"
        disabled={position === routeCount || reorderPending || actionsDisabled}
        onClick={onMoveDown}
      >
        <ArrowDown />
      </Button>
      <Button
        id={`edit-route-${route.id}`}
        variant="ghost"
        size="icon-lg"
        className="size-10 sm:size-8"
        aria-label={`Edit route ${position}`}
        disabled={actionsDisabled}
        onClick={onEdit}
      >
        <Pencil />
      </Button>
      <ConfirmDeleteAction
        label={`Delete route ${position}`}
        title={`Delete route ${position}?`}
        description={
          <>
            Alerts handled by this route will no longer be sent to{" "}
            <strong>{route.receiver}</strong>. This cannot be undone.
          </>
        }
        confirmLabel="Delete route"
        pending={deletePending || actionsDisabled}
        details={
          <DeleteOperations>
            <li className="pl-1">
              Delete route {position}. Alerts that matched it will be evaluated
              against the remaining routes.
            </li>
          </DeleteOperations>
        }
        onConfirm={onDelete}
      />
    </div>
  );

  return (
    <li
      data-matched={previewActive && matched ? "true" : undefined}
      className={cn(
        "group/route relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-3 pt-3 pb-4 transition-[background-color,opacity] duration-200 hover:bg-muted/50 sm:grid-cols-[auto_minmax(0,1fr)_auto]",
        previewActive &&
          (matched
            ? "bg-primary/5 ring-1 ring-primary/40 ring-inset"
            : "opacity-60"),
      )}
    >
      {connectTop && (
        <span
          aria-hidden
          className="absolute top-0 left-6.5 h-3 w-px -translate-x-1/2 bg-border"
        />
      )}
      {connectBottom && (
        <span
          aria-hidden
          className="absolute top-10 bottom-0 left-6.5 w-px -translate-x-1/2 bg-border"
        />
      )}
      <span
        className={cn(
          "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background font-mono text-xs text-muted-foreground tabular-nums",
          previewActive &&
            matched &&
            "border-primary/50 bg-primary/10 text-primary",
        )}
        title={`Route ${position} of ${routeCount}`}
      >
        {position}
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
          <div className="break-words text-xs text-muted-foreground">
            {timing.join(" · ")}
          </div>
        )}
        {warning && (
          <div
            className={cn(
              "flex items-start gap-1.5 text-xs",
              toneText({ tone: "warning" }),
            )}
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>{warning}</span>
          </div>
        )}
      </div>
      {actions}
      {onInsertAfter && (
        <Button
          id={`insert-route-after-${route.id}`}
          type="button"
          variant="outline"
          size="icon-sm"
          className="pointer-events-none absolute -bottom-2 left-6.5 z-10 -translate-x-1/2 rounded-full bg-background text-muted-foreground opacity-0 group-hover/route:pointer-events-auto group-hover/route:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-offset-0"
          aria-label={`Add route between ${position} and ${position + 1}`}
          title="Add route here"
          onClick={onInsertAfter}
        >
          <Plus aria-hidden />
        </Button>
      )}
    </li>
  );
}

function FallThroughRow({
  previewActive,
  fellThrough,
  connected,
}: {
  previewActive: boolean;
  /** The preview labels matched no route, so they land on this row. */
  fellThrough: boolean;
  connected: boolean;
}) {
  return (
    <li
      data-matched={fellThrough ? "true" : undefined}
      className={cn(
        "relative flex items-center gap-3 px-3 py-2 transition-opacity duration-200",
        previewActive &&
          (fellThrough
            ? "bg-primary/5 ring-1 ring-primary/40 ring-inset"
            : "opacity-40"),
      )}
    >
      {connected && (
        <span
          aria-hidden
          className="absolute top-0 left-6.5 h-2 w-px -translate-x-1/2 bg-border"
        />
      )}
      <span
        aria-hidden
        className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background font-mono text-xs text-muted-foreground"
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
        <span className={cn("font-mono", toneText({ tone: "warning" }))}>
          not delivered
        </span>
        <span className="text-muted-foreground">
          · add a catch-all route (no conditions) to set a default receiver
        </span>
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
        <Button
          variant="outline"
          size="sm"
          className="h-10 sm:h-7"
          onClick={onAction}
        >
          {action}
        </Button>
      )}
    </li>
  );
}

function DeliveryCoverage({
  routes,
  receivers,
  channelsByName,
  pending,
  unavailable,
}: {
  routes: CcRoute[];
  receivers: CcReceiver[];
  channelsByName: Map<string, CcChannel>;
  pending: boolean;
  unavailable: boolean;
}) {
  if (pending || unavailable) {
    return (
      <div
        role="status"
        className="flex items-start gap-2.5 border-b border-border/60 px-3 py-2.5 text-muted-foreground"
      >
        {pending ? (
          <LoaderCircle
            aria-hidden
            className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin"
          />
        ) : (
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        )}
        <div>
          <div className="text-sm font-medium">
            {pending ? "Checking delivery coverage" : "Coverage unavailable"}
          </div>
          <p className="text-xs">
            {pending
              ? "Loading routes, receivers, and channels."
              : "Resolve the configuration errors below to verify delivery coverage."}
          </p>
        </div>
      </div>
    );
  }

  const receiversByName = new Map(receivers.map((r) => [r.name, r]));
  const brokenRoute = routes.find((route) => {
    const receiver = receiversByName.get(route.receiver);
    return (
      receiver === undefined ||
      receiver.channels.some((channel) => !channelsByName.has(channel))
    );
  });
  const hasCatchAll = routes.some((route) => route.matchers.length === 0);

  let tone: "healthy" | "warning" | "muted" = "healthy";
  let title = "All alerts have a delivery path";
  let detail = "A catch-all route covers alerts that miss earlier routes.";

  if (brokenRoute) {
    tone = "warning";
    title = "Delivery configuration needs attention";
    detail = `The route to ${brokenRoute.receiver} references a missing receiver or channel.`;
  } else if (routes.length === 0) {
    tone = "warning";
    title = "No delivery path configured";
    detail = "Add a route before relying on notifications.";
  } else if (!hasCatchAll) {
    tone = "warning";
    title = "Unmatched alerts are not delivered";
    detail =
      "Add a catch-all route at the end of the pipeline to cover every alert.";
  }

  const Icon = tone === "healthy" ? CheckCircle2 : TriangleAlert;
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 border-b border-border/60 px-3 py-2.5"
    >
      <Icon
        aria-hidden
        className={cn("mt-0.5 size-4 shrink-0", toneText({ tone }))}
      />
      <div className="min-w-0">
        <div
          className={cn(
            "text-sm font-medium",
            tone === "healthy" ? "text-foreground" : toneText({ tone }),
          )}
        >
          {title}
        </div>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function SetupChecklist({
  channelCount,
  receiverCount,
  onAddChannel,
  onAddReceiver,
  onAddRoute,
}: {
  channelCount: number;
  receiverCount: number;
  onAddChannel: () => void;
  onAddReceiver: () => void;
  onAddRoute: () => void;
}) {
  return (
    <>
      <li className="px-3 py-2.5">
        <div className="text-sm font-medium">Set up delivery</div>
        <p className="max-w-prose text-xs text-muted-foreground">
          Alerts are evaluated and recorded in history, but delivered to no one
          until a route exists.
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
  previewValueNames,
  coveragePending,
  coverageUnavailable,
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
  /** Human names for rule and SLO ids included in test labels. */
  previewValueNames: Map<string, string>;
  coveragePending: boolean;
  coverageUnavailable: boolean;
  /** Open the create drawers owned by the sibling cards (setup checklist). */
  onAddChannel: () => void;
  onAddReceiver: () => void;
}) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(ccQueries.routes());
  const [editing, setEditing] = useState<
    | { kind: "edit"; route: CcRoute }
    | { kind: "insert"; index: number; returnFocusId: string }
    | null
  >(null);
  const [previewOpen, setPreviewOpen] = useState(false);
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
  });

  const reorder = useMutation({
    mutationFn: async (ordered: CcRoute[]) => {
      const updates = ordered
        .map((route, index) => ({ route, priority: index * 10 }))
        .filter(({ route, priority }) => route.priority !== priority);
      for (const { route, priority } of updates) {
        await updateCcRoute({
          data: { id: route.id, input: routeInput(route, priority) },
        });
      }
    },
    onSuccess: () => toast.success("Route order updated"),
    onError: (e) => toast.error(ccErrorMessage(e)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: ccQueries.routes().queryKey }),
  });

  const previewActive = Object.keys(previewLabels).length > 0;
  const sorted = [...(data ?? [])].sort((a, b) => a.priority - b.priority);
  const insertion = editing?.kind === "insert" ? editing : null;
  const fellThrough = previewActive && matchedRouteIds.size === 0;
  const unmatched = ccUnmatchedOutcome(sorted);
  const duplicatePriority = sorted.some(
    (route, index) =>
      index > 0 && route.priority === sorted[index - 1]?.priority,
  );

  const moveRoute = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= sorted.length) return;
    const ordered = [...sorted];
    [ordered[index], ordered[destination]] = [
      ordered[destination],
      ordered[index],
    ];
    reorder.mutate(ordered);
  };

  const closeRouteEditor = (focusId: string) => {
    setEditing(null);
    requestAnimationFrame(() => document.getElementById(focusId)?.focus());
  };

  return (
    <Card id="routes" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <SectionHeading>Delivery pipeline</SectionHeading>
        <CardDescription>
          Routes are checked top to bottom; the first match decides, unless it
          continues.
        </CardDescription>
        <CardAction>
          <Button
            id="new-route"
            className="h-10 sm:h-8"
            disabled={editing !== null}
            onClick={() =>
              setEditing({
                kind: "insert",
                index: sorted.length,
                returnFocusId: "new-route",
              })
            }
          >
            <Plus data-icon="inline-start" />
            New route
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <DeliveryCoverage
          routes={sorted}
          receivers={receivers}
          channelsByName={channelsByName}
          pending={coveragePending}
          unavailable={coverageUnavailable}
        />
        <Collapsible open={previewOpen} onOpenChange={setPreviewOpen}>
          <CcDisclosureTrigger
            open={previewOpen}
            className="rounded-none border-x-0 border-b border-t-0 bg-transparent px-3 py-2.5 hover:bg-muted/20"
          >
            <span className="text-xs font-medium text-foreground">
              Test delivery
            </span>
            <span className="text-xs text-muted-foreground">
              {previewActive
                ? `${Object.keys(previewLabels).length} ${Object.keys(previewLabels).length === 1 ? "label" : "labels"} selected`
                : "Check who would be notified"}
            </span>
          </CcDisclosureTrigger>
          <CollapsibleContent>
            <div className="border-b border-border/60 px-3 py-3">
              <RoutePreview
                labels={previewLabels}
                onLabelsChange={onPreviewLabelsChange}
                matchedRoutes={matchedRoutes}
                receiversByName={receiversByName}
                channelsByName={channelsByName}
                prefill={prefill}
                valueNames={previewValueNames}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
        <SectionBody
          isError={isError}
          error={error}
          isPending={isPending}
          skeletonRows={3}
        >
          {duplicatePriority && (
            <div
              role="alert"
              className={cn(
                "flex items-start gap-2 border-b border-border/60 px-3 py-2.5 text-xs",
                toneText({ tone: "warning" }),
              )}
            >
              <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Some routes share the same priority. Move either route once to
                normalize the pipeline order.
              </span>
            </div>
          )}
          <ul
            className={cn(
              sorted.length === 0 &&
                editing === null &&
                "divide-y divide-border/60",
            )}
          >
            {sorted.length === 0 && editing === null && (
              <SetupChecklist
                channelCount={channelsByName.size}
                receiverCount={receivers.length}
                onAddChannel={onAddChannel}
                onAddReceiver={onAddReceiver}
                onAddRoute={() =>
                  setEditing({
                    kind: "insert",
                    index: 0,
                    returnFocusId: "new-route",
                  })
                }
              />
            )}
            {sorted.map((r, index) => {
              const displayPosition =
                index +
                1 +
                (insertion !== null && index >= insertion.index ? 1 : 0);
              const displayRouteCount =
                sorted.length + (insertion !== null ? 1 : 0);

              return (
                <Fragment key={r.id}>
                  {insertion?.index === index && (
                    <RouteBuilder
                      route={null}
                      insertIndex={index}
                      onCancel={() => closeRouteEditor(insertion.returnFocusId)}
                      receivers={receivers}
                      routes={sorted}
                      connectTop={index > 0}
                      connectBottom={
                        index < sorted.length || unmatched !== "unreachable"
                      }
                    />
                  )}
                  {editing?.kind === "edit" && editing.route.id === r.id ? (
                    <RouteBuilder
                      route={r}
                      onCancel={() => closeRouteEditor(`edit-route-${r.id}`)}
                      receivers={receivers}
                      routes={sorted}
                      connectTop={index > 0}
                      connectBottom={
                        index < sorted.length - 1 || unmatched !== "unreachable"
                      }
                    />
                  ) : (
                    <PipelineRoute
                      route={r}
                      position={displayPosition}
                      routeCount={displayRouteCount}
                      receiver={receiversByName.get(r.receiver)}
                      channelsByName={channelsByName}
                      previewActive={previewActive}
                      matched={matchedRouteIds.has(r.id)}
                      connectTop={index > 0}
                      connectBottom={
                        index < sorted.length - 1 ||
                        insertion?.index === index + 1 ||
                        unmatched !== "unreachable"
                      }
                      warning={routeOrderWarning(
                        sorted,
                        index,
                        r.matchers,
                        r.continue,
                      )}
                      onMoveUp={() => moveRoute(index, -1)}
                      onMoveDown={() => moveRoute(index, 1)}
                      onEdit={() => setEditing({ kind: "edit", route: r })}
                      onInsertAfter={
                        editing === null && index < sorted.length - 1
                          ? () =>
                              setEditing({
                                kind: "insert",
                                index: index + 1,
                                returnFocusId: `insert-route-after-${r.id}`,
                              })
                          : undefined
                      }
                      onDelete={() => remove.mutateAsync(r.id)}
                      reorderPending={reorder.isPending}
                      deletePending={remove.isPending}
                      actionsDisabled={editing !== null}
                    />
                  )}
                </Fragment>
              );
            })}
            {insertion?.index === sorted.length && (
              <RouteBuilder
                key="new"
                route={null}
                insertIndex={insertion.index}
                onCancel={() => closeRouteEditor(insertion.returnFocusId)}
                receivers={receivers}
                routes={sorted}
                connectTop={insertion.index > 0}
                connectBottom={unmatched !== "unreachable"}
              />
            )}
            {unmatched !== "unreachable" && (
              <FallThroughRow
                previewActive={previewActive}
                fellThrough={fellThrough}
                connected={sorted.length > 0 || insertion !== null}
              />
            )}
          </ul>
        </SectionBody>
      </CardContent>
    </Card>
  );
}

// ── Address book ──────────────────────────────────────────────────────────────

function ReceiversSection({
  channels,
  routes,
  editing,
  onEditingChange,
  onReviewRoutes,
}: {
  channels: CcChannel[];
  /** For per-receiver usage facts; undefined while the routes query loads. */
  routes: CcRoute[] | undefined;
  /** Lifted so the pipeline's setup checklist can open the create drawer. */
  editing: CcReceiver | "new" | null;
  onEditingChange: (editing: CcReceiver | "new" | null) => void;
  onReviewRoutes: () => void;
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
  });

  return (
    <Card id="receivers" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <SectionHeading>Receivers</SectionHeading>
        <CardAction>
          <Button
            variant="outline"
            className="h-10 sm:h-8"
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
              const targetCount = targeting ?? 0;
              const confirmDisabledReason =
                routes === undefined
                  ? "Route references are still loading or unavailable. Try again after the pipeline is ready."
                  : targetCount > 0
                    ? `${targetCount} ${targetCount === 1 ? "route still targets" : "routes still target"} this receiver. Move ${targetCount === 1 ? "that route" : "those routes"} first. No changes will be made.`
                    : undefined;
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
                    size="icon-lg"
                    className="size-10 sm:size-8"
                    aria-label={`Edit receiver ${r.name}`}
                    onClick={() => onEditingChange(r)}
                  >
                    <Pencil />
                  </Button>
                  <ConfirmDeleteAction
                    label={`Delete receiver ${r.name}`}
                    title={`Delete “${r.name}”?`}
                    description={
                      routes === undefined
                        ? "References must load before this receiver can be deleted."
                        : targetCount > 0
                          ? "Routes still depend on this receiver, so it cannot be deleted yet."
                          : "No route targets this receiver. This cannot be undone."
                    }
                    confirmLabel="Delete receiver"
                    pending={remove.isPending}
                    details={
                      confirmDisabledReason === undefined ? (
                        <DeleteOperations>
                          <li className="pl-1">
                            Delete <span className="font-mono">{r.name}</span>.
                            Its channels remain available.
                          </li>
                        </DeleteOperations>
                      ) : undefined
                    }
                    confirmDisabledReason={confirmDisabledReason}
                    blockedAction={
                      targetCount > 0
                        ? { label: "Review routes", onClick: onReviewRoutes }
                        : undefined
                    }
                    onConfirm={() => remove.mutateAsync(r.name)}
                  />
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

function ChannelDeleteOperations({
  channelName,
  referencingReceivers,
}: {
  channelName: string;
  referencingReceivers: CcReceiver[];
}) {
  return (
    <DeleteOperations>
      {referencingReceivers.map((receiver) => (
        <li key={receiver.id} className="pl-1">
          Remove <span className="font-mono">{channelName}</span> from{" "}
          <strong className="font-medium text-foreground">
            {receiver.name}
          </strong>
          . It keeps{" "}
          <span className="font-mono text-foreground">
            {receiver.channels
              .filter((name) => name !== channelName)
              .join(", ")}
          </span>
          .
        </li>
      ))}
      <li className="pl-1">
        Delete <span className="font-mono">{channelName}</span>.
      </li>
    </DeleteOperations>
  );
}

function ChannelsSection({
  receivers,
  editing,
  onEditingChange,
  onEditReceiver,
}: {
  /** For per-channel usage facts; undefined while the receivers query loads. */
  receivers: CcReceiver[] | undefined;
  /** Lifted so the pipeline's setup checklist can open the create drawer. */
  editing: CcChannel | "new" | null;
  onEditingChange: (editing: CcChannel | "new" | null) => void;
  onEditReceiver: (receiver: CcReceiver) => void;
}) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(ccQueries.channels());

  const remove = useMutation({
    mutationFn: async ({
      name,
      referencingReceivers,
    }: {
      name: string;
      referencingReceivers: CcReceiver[];
    }) => {
      await Promise.all(
        referencingReceivers.map((receiver) =>
          updateCcReceiver({
            data: {
              name: receiver.name,
              channels: receiver.channels.filter(
                (channelName) => channelName !== name,
              ),
            },
          }),
        ),
      );
      await deleteCcChannel({ data: { name } });
      return referencingReceivers.length;
    },
    onSuccess: (receiverCount) => {
      toast.success(
        receiverCount === 0
          ? "Channel deleted"
          : `Channel deleted and ${receiverCount} ${receiverCount === 1 ? "receiver" : "receivers"} updated`,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ccQueries.channels().queryKey });
      qc.invalidateQueries({ queryKey: ccQueries.receivers().queryKey });
    },
  });

  return (
    <Card id="channels" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <SectionHeading>Channels</SectionHeading>
        <CardDescription>
          Saved secrets are hidden after you leave this page.
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            className="h-10 sm:h-8"
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
              const referencingReceivers = (receivers ?? []).filter((r) =>
                r.channels.includes(c.name),
              );
              const usedBy =
                receivers === undefined
                  ? undefined
                  : referencingReceivers.length;
              const blockingReceivers = referencingReceivers.filter(
                (receiver) => receiver.channels.length === 1,
              );
              const confirmDisabledReason =
                receivers === undefined
                  ? "Receiver references are still loading or unavailable. Try again after the Receivers section is ready."
                  : blockingReceivers.length > 0
                    ? `${blockingReceivers.map((receiver) => receiver.name).join(", ")} ${blockingReceivers.length === 1 ? "has" : "have"} no other channel. Add another channel there first. No changes will be made.`
                    : undefined;
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
                    size="icon-lg"
                    className="size-10 sm:size-8"
                    aria-label={`Edit channel ${c.name}`}
                    onClick={() => onEditingChange(c)}
                  >
                    <Pencil />
                  </Button>
                  <ConfirmDeleteAction
                    label={`Delete channel ${c.name}`}
                    title={`Delete “${c.name}”?`}
                    description={
                      blockingReceivers.length > 0
                        ? `This channel is the only destination for ${blockingReceivers.length} ${blockingReceivers.length === 1 ? "receiver" : "receivers"}, so it cannot be removed automatically yet.`
                        : referencingReceivers.length === 0
                          ? "This channel is not used by any receiver. This cannot be undone."
                          : `This will update ${referencingReceivers.length} ${referencingReceivers.length === 1 ? "receiver" : "receivers"} before deleting the channel. This cannot be undone.`
                    }
                    confirmLabel="Delete channel"
                    pending={remove.isPending}
                    details={
                      confirmDisabledReason === undefined ? (
                        <ChannelDeleteOperations
                          channelName={c.name}
                          referencingReceivers={referencingReceivers}
                        />
                      ) : undefined
                    }
                    confirmDisabledReason={confirmDisabledReason}
                    blockedAction={
                      blockingReceivers.length > 0
                        ? {
                            label: `Edit ${blockingReceivers[0]?.name}`,
                            onClick: () => {
                              const receiver = blockingReceivers[0];
                              if (receiver) onEditReceiver(receiver);
                            },
                          }
                        : undefined
                    }
                    onConfirm={() =>
                      remove.mutateAsync({
                        name: c.name,
                        referencingReceivers,
                      })
                    }
                  />
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
  });

  return (
    <Card id="inhibitions" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <SectionHeading>Inhibitions</SectionHeading>
        <CardDescription>
          Suppress noisy downstream alerts while a related, higher-level alert
          is already firing.
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            className="h-10 sm:h-8"
            onClick={() => setOpen(true)}
          >
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
                <ConfirmDeleteAction
                  label="Delete inhibition"
                  title="Delete this inhibition?"
                  description="Alerts currently suppressed by this rule may begin notifying immediately. This cannot be undone."
                  confirmLabel="Delete inhibition"
                  pending={remove.isPending}
                  details={
                    <DeleteOperations>
                      <li className="pl-1">
                        Delete this inhibition. Matching alerts will be
                        evaluated without it.
                      </li>
                    </DeleteOperations>
                  }
                  onConfirm={() => remove.mutateAsync(r.id)}
                />
              </li>
            ))}
          </ul>
        </SectionBody>
      </CardContent>
      <InhibitionBuilder open={open} onOpenChange={setOpen} />
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
  const [advancedOpen, setAdvancedOpen] = useState(
    () => location.hash === "inhibitions",
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
  const previewValueNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const rule of rules.data ?? []) {
      names.set(rule.id, ccRuleIdentity(rule).name);
    }
    for (const slo of slos.data ?? []) {
      names.set(slo.id, ccSloIdentity(slo).name);
    }
    return names;
  }, [rules.data, slos.data]);
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
        previewValueNames={previewValueNames}
        coveragePending={
          routes.isPending || receivers.isPending || channels.isPending
        }
        coverageUnavailable={
          routes.isError || receivers.isError || channels.isError
        }
        onAddChannel={() => setChannelEditing("new")}
        onAddReceiver={() => setReceiverEditing("new")}
      />

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <ReceiversSection
          channels={channels.data ?? []}
          routes={routes.data}
          editing={receiverEditing}
          onEditingChange={setReceiverEditing}
          onReviewRoutes={() =>
            document
              .getElementById("routes")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        />
        <ChannelsSection
          receivers={receivers.data}
          editing={channelEditing}
          onEditingChange={setChannelEditing}
          onEditReceiver={setReceiverEditing}
        />
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CcDisclosureTrigger open={advancedOpen} className="bg-card">
          <span className="text-xs font-medium">Advanced delivery</span>
          <span className="text-xs text-muted-foreground">inhibitions</span>
        </CcDisclosureTrigger>
        <CollapsibleContent>
          <div className="space-y-3 pt-3">
            <InhibitionsSection />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
