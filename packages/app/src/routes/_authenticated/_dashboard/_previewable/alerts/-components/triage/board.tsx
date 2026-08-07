// Every group here is firing: the route filters via alertingFiringGroups.

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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellOff, BookOpenText, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { silenceQueries } from "@/data/alerting/silences/queries";
import {
  createAlertingSilence,
  deleteAlertingSilence,
} from "@/data/alerting/silences/server";
import {
  alertingGroupSilenceMatchers,
  alertingInstanceIsUndeliverable,
  alertingRowBudget,
  alertingRunbookParams,
  alertingSourceScopedSilenceMatchers,
  type TriageGroup,
  type TriageRow,
} from "@/data/alerting/triage/summary";
import type {
  AlertingMatcher,
  AlertingSloStatusPayload,
} from "@/data/alerting/types";
import { parseResourceName } from "@/data/as-code/identity";
import {
  AlertingTableSkeleton,
  alertingErrorMessage,
  alertingFormatTs,
} from "../shared/components";
import { LabelSet, Pill } from "../shared/signal";
import { AlertingSeverityBadge, AlertingStatusDot } from "../shared/status";
import { AlertingSummaryLabel } from "../shared/summary-card";
import type { SilenceDrawerOptions } from "../silences/panel";
import { AlertingBudgetFact, alertingFmtBurn } from "../slos/budget-bar";
import { TriageDeliveryFact } from "./delivery-fact";
import { TriageInstanceDetail } from "./instance-detail";

// Shared fact-column widths in wide board containers: merged lines and sub-rows both use them,
// so the facts align down the whole card.
const COL_VALUE = "@[52rem]/triage:w-20";
const COL_BUDGET = "@[52rem]/triage:w-28";
const COL_SINCE = "@[52rem]/triage:w-20";
const COL_DELIVERY = "@[52rem]/triage:w-48";

function rowStartedAt(row: TriageRow): number {
  const time = row.lead.alert.active_since;
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

const lineActionClass =
  "flex size-11 shrink-0 items-center justify-center rounded text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:text-foreground focus-visible:outline-primary @[52rem]/triage:size-8 [&_svg]:size-3.5";

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
      {group.sloId !== undefined ? (
        group.slo ? (
          <Link
            to="/alerts/slos/$project/$slug"
            params={parseResourceName(group.slo.name)}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline-offset-2 hover:underline @[52rem]/triage:min-h-0"
          >
            {group.name}
          </Link>
        ) : (
          <span className="text-sm font-medium text-foreground">
            {group.name}
          </span>
        )
      ) : group.rule ? (
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
      {group.sloId !== undefined && (
        <Pill className="text-muted-foreground">SLO</Pill>
      )}
      {group.severity !== "info" && (
        <AlertingSeverityBadge severity={group.severity} />
      )}
    </>
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
  budget,
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
  /** This row's error budget remaining (0..1, may go negative). Null while
   *  the status snapshot is unresolved; rule rows have none and pass null. */
  budget: number | null;
  children?: React.ReactNode;
}) {
  const inst = row.lead;
  const { alert, silence } = inst;
  // For a single-instance source the source scope and the label scope cover
  // the same thing, so the merged line's silence mutes the whole source.
  const merged = group.rows.length === 1;
  const valueLabel = group.sloId !== undefined ? null : "value";
  const runbook = alertingRunbookParams(inst.rule);
  const isSlo = inst.slo !== undefined || alert.slo !== undefined;
  const shownLabels = isSlo ? {} : alert.labels;
  // Accessible name. Labels distinguish a row from its siblings; label-free
  // rows fall back to the source name (merged) or the firing tiers, so no two
  // rows announce identically as "Expand row".
  const rowName =
    Object.entries(shownLabels)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ") || (merged ? group.name : row.tiers.join(", ") || "row");
  const silenceLabel = merged ? group.name : rowName;
  // Oldest active_since across every member tier, not just the lead's.
  const activeSince = row.members
    .map((m) => m.alert.active_since)
    .filter((t): t is string => t !== null && t !== undefined)
    .sort()[0];
  const perTierRates = row.members
    .map(
      (m) =>
        `${m.alert.labels.slo_tier ?? "?"}: ${
          typeof m.alert.value === "number"
            ? alertingFmtBurn(m.alert.value)
            : "—"
        }`,
    )
    .join(" · ");
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
        // The fact cells share a two-line height (the budget meter hangs out
        // of flow); wide-container padding gives the hang room to clear the divider.
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
        {/* Rule rows keep the empty budget slot in wide containers so the grid holds. */}
        {isSlo ? (
          <AlertingBudgetFact
            remaining={budget}
            className={cn(COL_BUDGET, "pl-14 @[52rem]/triage:pl-0")}
          />
        ) : (
          <span
            aria-hidden
            className={cn("hidden shrink-0 @[52rem]/triage:block", COL_BUDGET)}
          />
        )}
        {/* Merged rows show the lead tier's rate and the rest in the tooltip. */}
        <FactCell
          col={COL_VALUE}
          className={isSlo ? undefined : "pl-14 @[52rem]/triage:pl-0"}
          label={isSlo ? "burning" : (valueLabel ?? "value")}
          title={
            isSlo
              ? row.members.length > 1
                ? `Budget burn by tier: ${perTierRates}`
                : typeof alert.value === "number"
                  ? `Error budget is being consumed ${alertingFmtBurn(alert.value)} faster than target`
                  : undefined
              : undefined
          }
        >
          <span className="font-mono text-xs tabular-nums">
            {isSlo && typeof alert.value === "number"
              ? alertingFmtBurn(alert.value)
              : (alert.value ?? "—")}
          </span>
        </FactCell>
        <FactCell
          col={COL_SINCE}
          label="firing since"
          title={
            activeSince
              ? `firing since ${alertingFormatTs(activeSince)}`
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
          {runbook && (
            <Link
              to="/runbooks/$project/$slug"
              params={runbook}
              aria-label="Runbook"
              title="Runbook"
              className={lineActionClass}
            >
              <BookOpenText />
            </Link>
          )}
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
        matcher.label === "rule" || matcher.label === "slo"
          ? group.name
          : undefined,
      ),
    },
  ];
}

export function TriageBoard({
  groups,
  pending,
  channelsByReceiver,
  sloStatuses,
  watchingRules,
  lastEventTs,
  eventsUnavailable,
  onCustomSilence,
}: {
  groups: TriageGroup[];
  pending: boolean;
  channelsByReceiver: Map<string, string[]>;
  sloStatuses: Map<string, AlertingSloStatusPayload | null>;
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
  const unroutedCount = groups.reduce(
    (count, group) =>
      count + group.rows.filter((row) => rowIsUnrouted(row)).length,
    0,
  );
  const groupBudget = (group: TriageGroup) =>
    group.sloId === undefined
      ? null
      : alertingRowBudget(sloStatuses.get(group.sloId));
  const groupBurn = (group: TriageGroup) =>
    Math.max(
      ...group.rows.flatMap((row) =>
        row.members.map((member) =>
          typeof member.alert.value === "number" ? member.alert.value : 0,
        ),
      ),
    );
  const shownGroups = [...groups].sort((a, b) => {
    const aBudget = groupBudget(a);
    const bBudget = groupBudget(b);
    return (
      (SEVERITY_PRIORITY[a.severity] ?? 3) -
        (SEVERITY_PRIORITY[b.severity] ?? 3) ||
      Number(b.rows.some(rowIsUnrouted)) - Number(a.rows.some(rowIsUnrouted)) ||
      Number((bBudget ?? 1) <= 0) - Number((aBudget ?? 1) <= 0) ||
      (a.sloId !== undefined && b.sloId !== undefined
        ? (aBudget ?? Number.POSITIVE_INFINITY) -
            (bBudget ?? Number.POSITIVE_INFINITY) || groupBurn(b) - groupBurn(a)
        : 0) ||
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
            void deleteAlertingSilence({ data: { id: created.id } })
              .then(() => {
                qc.invalidateQueries({
                  queryKey: silenceQueries.list().queryKey,
                });
                toast.success("Silence removed");
              })
              .catch((error) => toast.error(alertingErrorMessage(error)));
          },
        },
      });
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
        aria-label="Triage board"
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
                      budget={
                        group.sloId !== undefined
                          ? alertingRowBudget(sloStatuses.get(group.sloId))
                          : null
                      }
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
