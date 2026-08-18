import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from "@everr/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
} from "@everr/ui/components/collapsible";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCircle2,
  CornerDownRight,
  LoaderCircle,
  Pencil,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import {
  deleteAlertingRoute,
  updateAlertingRoute,
} from "@/data/alerting/delivery/server";
import { alertingIsCatchAll } from "@/data/alerting/routing/resolution";
import { alertingRouteTimingSummary } from "@/data/alerting/routing/timing";
import type {
  AlertingChannel,
  AlertingReceiver,
  AlertingRoute,
} from "@/data/alerting/types";
import { AlertingDisclosureTrigger } from "../common/disclosure";
import { Matchers } from "../common/labels";
import { alertingErrorMessage } from "../common/query-error";
import { RouteBuilder, routeOrderWarning } from "./route-builder";
import { ChannelChip, RoutePreview } from "./route-preview";
import {
  ConfirmDeleteAction,
  DeleteOperations,
  SectionBody,
  SectionHeading,
} from "./section-chrome";

function routeInput(route: AlertingRoute, priority = route.priority) {
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
  route: AlertingRoute;
  position: number;
  routeCount: number;
  receiver: AlertingReceiver | undefined;
  channelsByName: Map<string, AlertingChannel>;
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
  // Routes using default timing stay on one line.
  const timing = alertingRouteTimingSummary(
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
          <Matchers matchers={route.matchers} emptyLabel="any alert" />
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

/** First-run channel, receiver, and route sequence. */
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
  routes: AlertingRoute[];
  receivers: AlertingReceiver[];
  channelsByName: Map<string, AlertingChannel>;
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
        detail="The endpoint notifications are sent to: a webhook, Slack, Discord, or Telegram."
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
        detail="Matchers pick which alerts it receives; a route with no conditions matches every alert."
        action="Add route"
        onAction={onAddRoute}
      />
    </>
  );
}

export function PipelineSection({
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
  receivers: AlertingReceiver[];
  channelsByName: Map<string, AlertingChannel>;
  previewLabels: Record<string, string>;
  onPreviewLabelsChange: (labels: Record<string, string>) => void;
  matchedRoutes: AlertingRoute[];
  prefill: Record<string, string> | null;
  previewValueNames: Map<string, string>;
  coveragePending: boolean;
  coverageUnavailable: boolean;
  onAddChannel: () => void;
  onAddReceiver: () => void;
}) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(
    deliveryQueries.routes(),
  );
  const [editing, setEditing] = useState<
    | { kind: "edit"; route: AlertingRoute }
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
    mutationFn: (id: string) => deleteAlertingRoute({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deliveryQueries.routes().queryKey });
      toast.success("Route deleted");
    },
  });

  const reorder = useMutation({
    mutationFn: async (ordered: AlertingRoute[]) => {
      const updates = ordered
        .map((route, index) => ({ route, priority: index * 10 }))
        .filter(({ route, priority }) => route.priority !== priority);
      for (const { route, priority } of updates) {
        await updateAlertingRoute({
          data: { id: route.id, input: routeInput(route, priority) },
        });
      }
    },
    onSuccess: () => toast.success("Route order updated"),
    onError: (e) => toast.error(alertingErrorMessage(e)),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: deliveryQueries.routes().queryKey }),
  });

  const previewActive = Object.keys(previewLabels).length > 0;
  const sorted = [...(data ?? [])].sort((a, b) => a.priority - b.priority);
  const insertion = editing?.kind === "insert" ? editing : null;
  const fellThrough = previewActive && matchedRouteIds.size === 0;
  const hasCatchAll = sorted.some((route) =>
    alertingIsCatchAll(route.matchers),
  );
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
          <AlertingDisclosureTrigger
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
          </AlertingDisclosureTrigger>
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
                      connectBottom={index < sorted.length || !hasCatchAll}
                    />
                  )}
                  {editing?.kind === "edit" && editing.route.id === r.id ? (
                    <RouteBuilder
                      route={r}
                      onCancel={() => closeRouteEditor(`edit-route-${r.id}`)}
                      receivers={receivers}
                      routes={sorted}
                      connectTop={index > 0}
                      connectBottom={index < sorted.length - 1 || !hasCatchAll}
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
                        !hasCatchAll
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
                connectBottom={!hasCatchAll}
              />
            )}
            {!hasCatchAll && (
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
