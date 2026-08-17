// Every group here has at least one firing or pending instance: the route
// filters via alertingActiveGroups. Quiet rules render in quiet-rules.tsx.

import { Button, buttonVariants } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { RelativeTime } from "@everr/ui/components/relative-time";
import { cn } from "@everr/ui/lib/utils";
import {
  type UseMutationResult,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellOff, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ruleQueries } from "@/data/alerting/rules/queries";
import { formatDurationSeconds } from "@/data/alerting/rules/resource/window";
import {
  pauseAlertingRule,
  resumeAlertingRule,
} from "@/data/alerting/rules/server";
import { silenceQueries } from "@/data/alerting/silences/queries";
import {
  createAlertingSilence,
  expireAlertingSilence,
} from "@/data/alerting/silences/server";
import {
  alertingGroupSilenceMatchers,
  alertingInstanceIsUndeliverable,
  alertingRunbookParams,
  alertingSourceScopedSilenceMatchers,
  alertingStatusSince,
  STATUS_RANK,
  type TriageGroup,
  type TriageRow,
} from "@/data/alerting/triage/summary";
import type { AlertingMatcher, AlertingRuleView } from "@/data/alerting/types";
import { parseResourceName } from "@/data/as-code/identity";
import {
  AlertingPauseToggle,
  AlertingRunbookLink,
  AlertingTableSkeleton,
  alertingErrorMessage,
  alertingFormatTs,
} from "../shared/components";
import { LabelSet } from "../shared/signal";
import {
  AlertingHealthHeart,
  AlertingSeverityBadge,
  AlertingStatusDot,
} from "../shared/status";
import { AlertingSummaryLabel } from "../shared/summary-card";
import type { SilenceDrawerOptions } from "../silences/panel";
import { TriageDeliveryFact } from "./delivery-fact";
import { TriageInstanceDetail } from "./instance-detail";

// Shared fact-column widths in wide board containers: merged lines and sub-rows both use them,
// so the facts align down the whole card.
const COL_VALUE = "@[52rem]/triage:w-20";
const COL_SINCE = "@[52rem]/triage:w-20";
const COL_DELIVERY = "@[52rem]/triage:w-48";

function rowStartedAt(row: TriageRow): number {
  const time = alertingStatusSince(row.lead.alert);
  return time ? new Date(time).getTime() : 0;
}

// ── Line building blocks ──────────────────────────────────────────────────────

function LineActions({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto flex shrink-0 items-center justify-end gap-0.5 pl-14 @[52rem]/triage:ml-0 @[52rem]/triage:w-24 @[52rem]/triage:pl-0">
      {children}
    </span>
  );
}

function SilenceSplitAction({
  label,
  pending,
  onOpen,
  onQuick,
}: {
  label: string;
  pending: boolean;
  onOpen: () => void;
  onQuick: (hours: number) => void;
}) {
  return (
    <span className="flex shrink-0 items-center">
      <Button
        variant="outline"
        className="h-11 rounded-r-none border-r-0 px-3 text-muted-foreground @[52rem]/triage:h-8 @[52rem]/triage:px-2"
        aria-label={`Silence ${label}`}
        disabled={pending}
        onClick={onOpen}
      >
        <BellOff />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          aria-label={`Quick silence ${label}`}
          render={
            <Button
              variant="outline"
              className="h-11 rounded-l-none gap-1 px-1.5 text-muted-foreground @[52rem]/triage:h-8"
            />
          }
        >
          <ChevronDown className="size-3" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Quick silence</DropdownMenuLabel>
            {[1, 8, 24].map((hours) => (
              <DropdownMenuItem
                key={hours}
                className="min-h-11 md:min-h-7"
                onClick={() => onQuick(hours)}
              >
                {hours} {hours === 1 ? "hour" : "hours"}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function FactCell({
  col,
  label,
  title,
  className,
  children,
}: {
  /** The column's shared width class (COL_*), so the grid holds across rows. */
  col: string;
  label: string;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 flex-col whitespace-nowrap @[52rem]/triage:items-end",
        col,
        className,
      )}
      title={title}
    >
      <AlertingSummaryLabel className="truncate">{label}</AlertingSummaryLabel>
      {children}
    </span>
  );
}

function GroupIdentity({ group }: { group: TriageGroup }) {
  return (
    <>
      {group.rule ? (
        <Link
          to="/alerts/rules/$project/$slug"
          params={parseResourceName(group.rule.name)}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline-offset-2 hover:underline @[52rem]/triage:min-h-0"
        >
          {group.name}
        </Link>
      ) : (
        <span className="text-sm font-medium text-foreground">
          {group.name}
        </span>
      )}
      <AlertingHealthHeart status={group.rule?.health.status} />
      {group.severity !== "info" && (
        <AlertingSeverityBadge severity={group.severity} />
      )}
      {group.rule && (
        <span className="text-[0.6875rem] text-muted-foreground">
          Every {formatDurationSeconds(group.rule.spec.interval_secs)}
        </span>
      )}
    </>
  );
}

/** A rule's pause control. Both the group header and the merged single-row
 *  path need it, and a group whose rule is gone (deleted while firing) has
 *  nothing to pause. */
function RulePauseAction({
  group,
  mutation,
}: {
  group: TriageGroup;
  mutation: UseMutationResult<
    unknown,
    Error,
    { ruleId: string; rule: AlertingRuleView }
  >;
}) {
  const rule = group.rule;
  if (!rule) return null;
  return (
    <AlertingPauseToggle
      paused={rule.paused}
      pending={mutation.isPending && mutation.variables?.ruleId === rule.id}
      kind="alert rule"
      name={group.name}
      onToggle={() => mutation.mutate({ ruleId: rule.id, rule })}
    />
  );
}

function InstanceRow({
  row,
  group,
  expanded,
  onToggle,
  onOpenSilence,
  onQuickSilence,
  silencePending,
  deliveryFact,
  pauseAction,
  children,
}: {
  row: TriageRow;
  group: TriageGroup;
  expanded: boolean;
  onToggle: () => void;
  onOpenSilence: () => void;
  onQuickSilence: (hours: number) => void;
  silencePending: boolean;
  deliveryFact: React.ReactNode;
  /** Rendered before the silence action when this row carries its group's
   *  identity (the merged path), because then there is no group header to
   *  hold it. */
  pauseAction?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const inst = row.lead;
  const { alert, silence } = inst;
  // For a single-instance source the source scope and the label scope cover
  // the same thing, so the merged line's silence mutes the whole source.
  const merged = group.rows.length === 1;
  const runbook = alertingRunbookParams(inst.rule);
  const shownLabels = alert.labels;
  // Accessible name. Labels distinguish a row from its siblings; label-free
  // rows fall back to the source name.
  const rowName =
    Object.entries(shownLabels)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ") || (merged ? group.name : "row");
  const silenceLabel = merged ? group.name : rowName;
  const activeSince = row.members
    .map((m) => alertingStatusSince(m.alert))
    .filter((t): t is string => t !== null && t !== undefined)
    .sort()[0];
  return (
    <div>
      {/* Mouse convenience only; the chevron button is the keyboard and
          screen-reader target. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the chevron button is the keyboard target */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: mouse convenience only */}
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a,button") !== null) return;
          onToggle();
        }}
        // The fact cells share a two-line height.
        className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 transition-colors duration-150 hover:bg-muted/40 @[52rem]/triage:flex-nowrap @[52rem]/triage:gap-y-0.5 @[52rem]/triage:pb-2.5"
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${rowName}`}
          onClick={onToggle}
          className="flex size-11 shrink-0 items-center justify-center rounded text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:text-foreground focus-visible:outline-primary @[52rem]/triage:size-8"
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
        </button>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          {merged && <GroupIdentity group={group} />}
          {(Object.keys(shownLabels).length > 0 || !merged) && (
            <LabelSet labels={shownLabels} emptyLabel="no labels" />
          )}
        </span>
        {/* Forces the fact columns onto their own line in narrow containers; the pl-8 on
            the first cell lines that row up under the content column. */}
        <span className="basis-full @[52rem]/triage:hidden" aria-hidden />
        <FactCell
          col={COL_VALUE}
          className="pl-14 @[52rem]/triage:pl-0"
          label="value"
        >
          <span className="font-mono text-xs tabular-nums">
            {alert.value ?? "—"}
          </span>
        </FactCell>
        <FactCell
          col={COL_SINCE}
          label={`${alert.status} since`}
          title={
            activeSince
              ? `${alert.status} since ${alertingFormatTs(activeSince)}`
              : undefined
          }
        >
          <span className="text-xs text-foreground">
            {activeSince ? <RelativeTime timestamp={activeSince} /> : "—"}
          </span>
        </FactCell>
        {/* Its own line in narrow containers: clipping delivery status can
            assert the opposite of the truth. */}
        <span
          className={cn(
            "flex min-w-0 basis-full items-center gap-2 overflow-hidden pl-14 @[52rem]/triage:basis-auto @[52rem]/triage:pl-0 @[52rem]/triage:flex-none @[52rem]/triage:justify-end",
            COL_DELIVERY,
          )}
        >
          {silence ? (
            <span
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              title={[
                silence.comment,
                `until ${alertingFormatTs(silence.ends_at)}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            >
              <BellOff className="size-3" />
              silenced
            </span>
          ) : (
            deliveryFact
          )}
        </span>
        <LineActions>
          {pauseAction}
          {runbook && <AlertingRunbookLink {...runbook} name={group.name} />}
          <SilenceSplitAction
            label={silenceLabel}
            pending={silencePending}
            onOpen={onOpenSilence}
            onQuick={onQuickSilence}
          />
        </LineActions>
      </div>
      {expanded && children}
    </div>
  );
}

// ── Board ─────────────────────────────────────────────────────────────────────

const SEVERITY_PRIORITY: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function silenceSeed(
  group: TriageGroup,
  row?: TriageRow,
): readonly [AlertingMatcher[], SilenceDrawerOptions] {
  const matchers = row
    ? alertingSourceScopedSilenceMatchers(row.lead.alert)
    : alertingGroupSilenceMatchers(group);
  return [
    matchers,
    {
      lockSeed: true,
      seedValueLabels: matchers.map((matcher) =>
        matcher.label === "rule" ? group.name : undefined,
      ),
    },
  ];
}

export function TriageBoard({
  groups,
  pending,
  channelsByReceiver,
  watchingRules,
  lastEventTs,
  eventsUnavailable,
  onCustomSilence,
}: {
  groups: TriageGroup[];
  pending: boolean;
  channelsByReceiver: Map<string, string[]>;
  /** How many rules are unpaused, for the all-clear readout. */
  watchingRules: number;
  lastEventTs: string | null;
  /** Whether the event read failed; a failed read must not read as "no events". */
  eventsUnavailable: boolean;
  /**
   * Opens the create drawer seeded with these matchers. A prop because the
   * drawer is shared with the silences panel outside this board.
   */
  onCustomSilence: (
    matchers: AlertingMatcher[],
    options?: SilenceDrawerOptions,
  ) => void;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const qc = useQueryClient();
  const rowIsUnrouted = (row: TriageRow) =>
    row.lead.silence === null &&
    alertingInstanceIsUndeliverable(row.lead, channelsByReceiver);
  // Pending rows have not fired yet, so they have nothing to deliver:
  // the banner below only speaks about firing alerts, and must count only those.
  const unroutedCount = groups.reduce(
    (count, group) =>
      count +
      group.rows.filter(
        (row) => row.lead.alert.status === "firing" && rowIsUnrouted(row),
      ).length,
    0,
  );
  const shownGroups = [...groups].sort((a, b) => {
    return (
      (STATUS_RANK[a.rows[0].lead.alert.status] ?? 3) -
        (STATUS_RANK[b.rows[0].lead.alert.status] ?? 3) ||
      (SEVERITY_PRIORITY[a.severity] ?? 3) -
        (SEVERITY_PRIORITY[b.severity] ?? 3) ||
      Number(b.rows.some(rowIsUnrouted)) - Number(a.rows.some(rowIsUnrouted)) ||
      rowStartedAt(b.rows[0]) - rowStartedAt(a.rows[0]) ||
      a.name.localeCompare(b.name)
    );
  });
  const quickSilence = useMutation({
    mutationFn: ({
      matchers,
      hours,
    }: {
      scopeKey: string;
      matchers: AlertingMatcher[];
      hours: number;
    }) => {
      // One clock read: two would let the window straddle a millisecond and
      // come out at hours + 1ms.
      const now = Date.now();
      return createAlertingSilence({
        data: {
          matchers,
          starts_at: new Date(now).toISOString(),
          ends_at: new Date(now + hours * 3_600_000).toISOString(),
          comment: `silenced from triage (${hours}h)`,
        },
      });
    },
    onSuccess: (created, { hours }) => {
      qc.invalidateQueries({ queryKey: silenceQueries.list().queryKey });
      toast.success(`Silenced for ${hours}h`, {
        action: {
          label: "Undo",
          onClick: () => {
            // Undo cancels rather than deletes, so the silence stays in the
            // list as cancelled. Nothing was silenced in the seconds it was
            // open, but the record of it having existed is the point.
            void expireAlertingSilence({ data: { id: created.id } })
              .then(() => {
                qc.invalidateQueries({
                  queryKey: silenceQueries.list().queryKey,
                });
                toast.success("Silence cancelled");
              })
              .catch((error) => toast.error(alertingErrorMessage(error)));
          },
        },
      });
    },
    onError: (e) => toast.error(alertingErrorMessage(e)),
  });
  const togglePause = useMutation({
    mutationFn: ({ rule }: { ruleId: string; rule: AlertingRuleView }) =>
      rule.paused
        ? resumeAlertingRule({ data: { ruleId: rule.id } })
        : pauseAlertingRule({ data: { ruleId: rule.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ruleQueries.rulesFamily });
      toast.success("Rule updated");
    },
    onError: (e) => toast.error(alertingErrorMessage(e)),
  });

  return (
    <div className="space-y-2">
      {unroutedCount > 0 && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 lg:flex-row lg:items-center"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-destructive">
              {unroutedCount}{" "}
              {unroutedCount === 1 ? "firing alert is" : "firing alerts are"}{" "}
              not being delivered
            </p>
          </div>
          <Link
            to="/alerts/delivery"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-11 lg:min-h-8",
            )}
          >
            Configure delivery
          </Link>
        </div>
      )}

      {/* A landmark distinct from the silences panel below, for assistive tech. */}
      <Card
        inset="flush-content"
        role="region"
        aria-label="Active alerts"
        aria-busy={pending}
        className="@container/triage"
      >
        <CardHeader className="border-b border-border/60 py-2">
          <CardTitle>
            <h2>Active alerts</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pending ? (
            <AlertingTableSkeleton rows={6} />
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
              <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                <AlertingStatusDot tone="healthy" />
                All clear
              </span>
              <p className="text-xs text-muted-foreground tabular-nums">
                {watchingRules} {watchingRules === 1 ? "rule" : "rules"}{" "}
                watching
                {eventsUnavailable ? (
                  " · event history unavailable"
                ) : lastEventTs ? (
                  <>
                    {" · last event "}
                    <RelativeTime timestamp={lastEventTs} />
                  </>
                ) : (
                  " · no events in the last 24h"
                )}
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Firing instances appear here when a rule&rsquo;s condition is
                met.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {shownGroups.map((group) => {
                const merged = group.rows.length === 1;
                const rows = group.rows.map((row) => {
                  const [matchers, options] = silenceSeed(
                    group,
                    merged ? undefined : row,
                  );
                  const scopeKey = row.lead.alert.key;
                  return (
                    <InstanceRow
                      key={scopeKey}
                      row={row}
                      group={group}
                      expanded={expandedKey === scopeKey}
                      onToggle={() =>
                        setExpandedKey((k) =>
                          k === scopeKey ? null : scopeKey,
                        )
                      }
                      onOpenSilence={() => {
                        onCustomSilence(matchers, options);
                      }}
                      onQuickSilence={(hours) =>
                        quickSilence.mutate({ scopeKey, matchers, hours })
                      }
                      silencePending={
                        quickSilence.isPending &&
                        quickSilence.variables?.scopeKey === scopeKey
                      }
                      deliveryFact={
                        <TriageDeliveryFact
                          directChannels={row.lead.directChannels}
                          matchedRoutes={row.lead.matchedRoutes}
                          channelsByReceiver={channelsByReceiver}
                        />
                      }
                      pauseAction={
                        merged ? (
                          <RulePauseAction
                            group={group}
                            mutation={togglePause}
                          />
                        ) : null
                      }
                    >
                      <TriageInstanceDetail instance={row.lead} />
                    </InstanceRow>
                  );
                });
                return (
                  // Rows carry the padding so their hover highlight runs
                  // divider to divider.
                  <section key={group.sourceId}>
                    {merged ? (
                      rows
                    ) : (
                      <>
                        <div className="flex items-center gap-2 px-3 pt-2 pb-0.5">
                          <GroupIdentity group={group} />
                          <span className="ml-auto flex shrink-0 items-center">
                            <RulePauseAction
                              group={group}
                              mutation={togglePause}
                            />
                            <SilenceSplitAction
                              label={group.name}
                              pending={
                                quickSilence.isPending &&
                                quickSilence.variables?.scopeKey ===
                                  `group:${group.sourceId}`
                              }
                              onOpen={() => {
                                onCustomSilence(...silenceSeed(group));
                              }}
                              onQuick={(hours) => {
                                quickSilence.mutate({
                                  scopeKey: `group:${group.sourceId}`,
                                  matchers: silenceSeed(group)[0],
                                  hours,
                                });
                              }}
                            />
                          </span>
                        </div>
                        {rows}
                      </>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
