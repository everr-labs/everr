// Every group here is firing: the route filters via ccFiringGroups.

import { Button, buttonVariants } from "@everr/ui/components/button";
import { Card, CardContent } from "@everr/ui/components/card";
import { RelativeTime } from "@everr/ui/components/relative-time";
import { Skeleton } from "@everr/ui/components/skeleton";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellOff, BookOpenText, ChevronRight, FileSearch } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ccEventStatus } from "@/data/alerts/event-types";
import { fromCcRule } from "@/data/alerts/mapping";
import { parseResourceName } from "@/data/as-code/identity";
import { ccQueries } from "@/data/cc/queries";
import { createCcSilence } from "@/data/cc/server";
import {
  ccBudgetIndex,
  ccDeliveryFanout,
  ccGroupSilenceMatchers,
  ccInstanceLogsSearch,
  ccRowBudget,
  ccRunbookParams,
  ccSourceScopedSilenceMatchers,
  TRIAGE_EVENT_RANGE,
  type TriageGroup,
  type TriageInstance,
  type TriageRow,
} from "@/data/cc/triage";
import type {
  CcAlert,
  CcMatcher,
  CcRoute,
  CcSloGroupStatus,
} from "@/data/cc/types";
import { CcBudgetBar, ccFmtBurn } from "./budget-bar";
import {
  CcSeverityBadge,
  CcStatusDot,
  CcTableSkeleton,
  Conditions,
  ccErrorMessage,
  ccFormatTs,
  EvidenceChips,
  LabelSet,
  Pill,
} from "./shared";

// The expanded row needs the newest evidence-carrying event plus the last 6
// transitions; 100 is generous headroom.
const TRIAGE_INSTANCE_EVENT_LIMIT = 100;

// Shared fact-column widths (md+): merged lines and sub-rows both use them,
// so the facts align down the whole card.
const COL_VALUE = "md:w-20";
const COL_BUDGET = "md:w-28";
const COL_SINCE = "md:w-20";
const COL_DELIVERY = "md:w-48";

// ── Delivery fact ─────────────────────────────────────────────────────────────

function DeliveryFact({
  matchedRoutes,
  channelsByReceiver,
}: {
  matchedRoutes: CcRoute[];
  channelsByReceiver: Map<string, string[]>;
}) {
  if (matchedRoutes.length === 0) {
    return (
      <Link
        to="/alerts/delivery"
        hash="routes"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "whitespace-nowrap text-xs underline-offset-2 hover:underline",
          toneText({ tone: "warning" }),
        )}
      >
        not routed · not delivered
      </Link>
    );
  }
  const { receivers, channels, dead } = ccDeliveryFanout(
    matchedRoutes,
    channelsByReceiver,
  );
  // "+N" overflow instead of CSS truncation, which chops receiver names
  // mid-word; the full list stays on the tooltip.
  const shown = receivers.slice(0, 2);
  const names =
    shown.join(", ") +
    (receivers.length > shown.length
      ? ` +${receivers.length - shown.length}`
      : "");
  if (channels.length === 0) {
    // Routed, but every matched receiver fans out to zero channels: the
    // notification reaches no one.
    return (
      <Link
        to="/alerts/delivery"
        hash="receivers"
        onClick={(e) => e.stopPropagation()}
        title={receivers.join(", ")}
        className={cn(
          "whitespace-nowrap text-xs underline-offset-2 hover:underline",
          toneText({ tone: "warning" }),
        )}
      >
        → {names} · no channels
      </Link>
    );
  }
  return (
    <span
      className="truncate font-mono text-xs text-muted-foreground"
      title={[
        receivers.join(", "),
        channels.join(", "),
        dead.length > 0 ? `no channels: ${dead.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <span aria-hidden>→ </span>
      <span className="text-foreground">{names}</span>
    </span>
  );
}

// ── Row expansion ─────────────────────────────────────────────────────────────

function InstanceDetail({
  inst,
  onSilence,
  silencePending,
  onCustomSilence,
}: {
  inst: TriageInstance;
  onSilence: (hours: number) => void;
  silencePending: boolean;
  onCustomSilence: () => void;
}) {
  const { alert, rule } = inst;
  // Fetched (and polled) only while the row is expanded; the fingerprint
  // narrows server-side, so one row's detail never ships the whole window.
  const ownEvents = useQuery(
    ccQueries.eventHistory(TRIAGE_EVENT_RANGE, {
      fingerprint: alert.key,
      limit: TRIAGE_INSTANCE_EVENT_LIMIT,
    }),
  );
  const own = ownEvents.data ?? [];
  const latest = own.find(
    (e) => e.evidence && Object.keys(e.evidence).length > 0,
  );
  const transitions = own
    .filter((e) => ccEventStatus(e.eventType) !== null)
    .slice(0, 6);
  const runbook = ccRunbookParams(rule);
  const description = rule ? fromCcRule(rule).displayDescription : null;

  return (
    <div className="space-y-3 border-t border-border/60 bg-muted/10 px-3 py-3 pl-9">
      {description && (
        <p className="max-w-prose text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {latest?.evidence && (
        <div className="space-y-1">
          <div className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
            Evidence
          </div>
          <EvidenceChips
            evidence={latest.evidence}
            truncated={latest.evidenceTruncated}
          />
        </div>
      )}

      <div className="space-y-1">
        <div className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
          Route
        </div>
        {inst.matchedRoutes.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            no route matches: recorded in history, delivered to no one
          </span>
        ) : (
          <div className="space-y-1">
            {inst.matchedRoutes.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-foreground">
                  {r.receiver}
                </span>
                <Conditions matchers={r.matchers} emptyLabel="* (catch-all)" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
          Recent transitions
        </div>
        {ownEvents.isPending ? (
          <Skeleton className="h-4 w-44" />
        ) : transitions.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            no stored transitions in the last 24h
          </span>
        ) : (
          <ul className="space-y-0.5">
            {transitions.map((e) => (
              <li
                key={`${e.timestamp}-${e.eventType}`}
                className="flex items-center gap-2 text-xs tabular-nums"
              >
                <CcStatusDot
                  tone={
                    ccEventStatus(e.eventType) === "firing" ? "danger" : "muted"
                  }
                />
                <span className="w-14 text-muted-foreground">
                  {ccEventStatus(e.eventType) ?? e.eventType}
                </span>
                <RelativeTime
                  timestamp={e.timestamp}
                  className="text-muted-foreground/80"
                  title={ccFormatTs(e.timestamp)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          last seen{" "}
          {alert.last_seen ? <RelativeTime timestamp={alert.last_seen} /> : "—"}
        </span>
        {alert.absent_count > 0 && <span>absent x{alert.absent_count}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="pr-1 text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
          Silence
        </span>
        {[1, 8, 24].map((h) => (
          <Button
            key={h}
            variant="outline"
            size="sm"
            disabled={silencePending}
            onClick={() => onSilence(h)}
          >
            {h}h
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={silencePending}
          onClick={onCustomSilence}
        >
          Custom
        </Button>
        {runbook && (
          <Link
            to="/runbooks/$project/$slug"
            params={runbook}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            <BookOpenText data-icon="inline-start" />
            Runbook
          </Link>
        )}
        <Link
          to="/logs"
          search={ccInstanceLogsSearch(alert)}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          <FileSearch data-icon="inline-start" />
          View logs
        </Link>
      </div>
    </div>
  );
}

// ── Line building blocks ──────────────────────────────────────────────────────

// Hidden below md: the expanded detail carries every action, which is the
// touch path.
function LineActions({ children }: { children: React.ReactNode }) {
  return (
    // Fixed width: the runbook shortcut exists only on some rows, and a
    // shrinking slot would knock the fact columns out of alignment.
    <span className="hidden shrink-0 items-center justify-end gap-0.5 md:flex md:w-14">
      {children}
    </span>
  );
}

const lineActionClass =
  "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:text-foreground focus-visible:outline-primary [&_svg]:size-3.5";

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
        "flex shrink-0 flex-col whitespace-nowrap md:items-end",
        col,
        className,
      )}
      title={title}
    >
      <span className="truncate text-[0.625rem] font-medium tracking-wide text-muted-foreground/70 uppercase">
        {label}
      </span>
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
            className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
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
          className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
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
        <CcSeverityBadge severity={group.severity} />
      )}
    </>
  );
}

function InstanceRow({
  row,
  group,
  expanded,
  onToggle,
  onGroupSilence,
  deliveryFact,
  budget,
  children,
}: {
  row: TriageRow;
  group: TriageGroup;
  expanded: boolean;
  onToggle: () => void;
  onGroupSilence: () => void;
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
  const valueLabel =
    group.sloId !== undefined ? null : (group.rule?.spec.value_column ?? null);
  const runbook = ccRunbookParams(inst.rule);
  const isSlo = inst.slo !== undefined || alert.slo !== undefined;
  const shownLabels = isSlo
    ? Object.fromEntries(
        Object.entries(alert.labels).filter(([k]) => k !== "slo_tier"),
      )
    : alert.labels;
  // Accessible name. Labels distinguish a row from its siblings; label-free
  // rows fall back to the source name (merged) or the firing tiers, so no two
  // rows announce identically as "Expand row".
  const rowName =
    Object.entries(shownLabels)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ") || (merged ? group.name : row.tiers.join(", ") || "row");
  // Oldest active_since across every member tier, not just the lead's.
  const activeSince = row.members
    .map((m) => m.alert.active_since)
    .filter((t): t is string => t !== null && t !== undefined)
    .sort()[0];
  const perTierRates = row.members
    .map(
      (m) =>
        `${m.alert.labels.slo_tier ?? "?"}: ${
          typeof m.alert.value === "number" ? ccFmtBurn(m.alert.value) : "—"
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
        // of flow); md:pb-2.5 gives the hang room to clear the row divider.
        className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 transition-colors duration-150 hover:bg-muted/40 md:flex-nowrap md:pb-2.5"
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${rowName}`}
          onClick={onToggle}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:text-foreground focus-visible:outline-primary"
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
        {/* Forces the fact columns onto their own line below md; the pl-8 on
            the first cell lines that row up under the content column. */}
        <span className="basis-full md:hidden" aria-hidden />
        {/* Rule rows keep the empty budget slot on md+ so the grid holds. */}
        {isSlo ? (
          <FactCell
            col={COL_BUDGET}
            className="pl-8 md:pl-0"
            label="budget left"
            title="Error budget remaining"
          >
            {/* `hang` keeps the figure on the shared value line, the meter
                tucked into the row padding (md:pb-2.5 above). */}
            <CcBudgetBar remaining={budget} hang className="w-24" />
          </FactCell>
        ) : (
          <span
            aria-hidden
            className={cn("hidden shrink-0 md:block", COL_BUDGET)}
          />
        )}
        {/* Burn rates print at the engine's own precision (one decimal, ×);
            a merged row shows its lead tier's rate, the rest on the tooltip. */}
        <FactCell
          col={COL_VALUE}
          className={isSlo ? undefined : "pl-8 md:pl-0"}
          label={isSlo ? "burn rate" : (valueLabel ?? "value")}
          title={
            isSlo && row.members.length > 1
              ? `burn rate — ${perTierRates}`
              : undefined
          }
        >
          <span className="font-mono text-xs tabular-nums">
            {isSlo && typeof alert.value === "number"
              ? ccFmtBurn(alert.value)
              : (alert.value ?? "—")}
          </span>
        </FactCell>
        <FactCell
          col={COL_SINCE}
          label="firing since"
          title={
            activeSince ? `firing since ${ccFormatTs(activeSince)}` : undefined
          }
        >
          <span className="text-xs text-muted-foreground">
            {activeSince ? <RelativeTime timestamp={activeSince} /> : "—"}
          </span>
        </FactCell>
        {/* Its own line below md: "not routed" clipped to "routed" would
            assert the opposite of the truth. */}
        <span
          className={cn(
            "flex min-w-0 items-center gap-2 overflow-hidden max-md:basis-full max-md:pl-8 md:flex-none md:justify-end",
            COL_DELIVERY,
          )}
        >
          {silence && (
            <span
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              title={[silence.comment, `until ${ccFormatTs(silence.ends_at)}`]
                .filter(Boolean)
                .join(" · ")}
            >
              <BellOff className="size-3" />
              silenced
            </span>
          )}
          {deliveryFact}
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
          {/* A merged line's silence mutes the whole source; a sub-row's pins
              this row's labels so its siblings keep paging. */}
          <button
            type="button"
            aria-label={
              merged
                ? `Silence everything under ${group.name}`
                : `Silence ${rowName}`
            }
            title="Silence"
            onClick={onGroupSilence}
            className={lineActionClass}
          >
            <BellOff />
          </button>
        </LineActions>
      </div>
      {expanded && children}
    </div>
  );
}

// ── Board ─────────────────────────────────────────────────────────────────────

export function TriageBoard({
  groups,
  pending,
  channelsByReceiver,
  sloStatusGroups,
  watchingRules,
  lastEventTs,
  eventsUnavailable,
  onCustomSilence,
}: {
  groups: TriageGroup[];
  pending: boolean;
  channelsByReceiver: Map<string, string[]>;
  sloStatusGroups: Map<string, CcSloGroupStatus[]>;
  /** How many rules are unpaused, for the all-clear readout. */
  watchingRules: number;
  lastEventTs: string | null;
  /** Whether the event read failed; a failed read must not read as "no events". */
  eventsUnavailable: boolean;
  /**
   * Opens the create drawer seeded with these matchers. A prop because the
   * drawer is shared with the silences panel outside this board.
   */
  onCustomSilence: (matchers: CcMatcher[]) => void;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const qc = useQueryClient();
  const silenceInstance = useMutation({
    mutationFn: ({ alert, hours }: { alert: CcAlert; hours: number }) => {
      // One clock read: two would let the window straddle a millisecond and
      // come out at hours + 1ms.
      const now = Date.now();
      return createCcSilence({
        data: {
          matchers: ccSourceScopedSilenceMatchers(alert),
          starts_at: new Date(now).toISOString(),
          ends_at: new Date(now + hours * 3_600_000).toISOString(),
          comment: `silenced from triage (${hours}h)`,
        },
      });
    },
    onSuccess: (_, { hours }) => {
      qc.invalidateQueries({ queryKey: ccQueries.silences().queryKey });
      toast.success(`Silenced for ${hours}h`);
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  const budgetIndexes = useMemo(
    () =>
      new Map(
        [...sloStatusGroups].map(([id, groups]) => [id, ccBudgetIndex(groups)]),
      ),
    [sloStatusGroups],
  );

  return (
    // A landmark distinct from the silences panel below, for assistive tech.
    <Card inset="flush-content" role="region" aria-label="Triage board">
      <CardContent>
        {pending ? (
          <CcTableSkeleton rows={6} />
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
              <CcStatusDot tone="healthy" />
              All clear
            </span>
            <p className="text-xs text-muted-foreground tabular-nums">
              {watchingRules} {watchingRules === 1 ? "rule" : "rules"} watching
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
              Firing instances appear here the moment a rule&rsquo;s query
              returns rows.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {groups.map((group) => {
              const merged = group.rows.length === 1;
              const rows = group.rows.map((row) => (
                <InstanceRow
                  key={row.lead.alert.key}
                  row={row}
                  group={group}
                  budget={
                    group.sloId !== undefined
                      ? ccRowBudget(row, budgetIndexes.get(group.sloId))
                      : null
                  }
                  expanded={expandedKey === row.lead.alert.key}
                  onToggle={() =>
                    setExpandedKey((k) =>
                      k === row.lead.alert.key ? null : row.lead.alert.key,
                    )
                  }
                  onGroupSilence={() =>
                    onCustomSilence(
                      merged
                        ? ccGroupSilenceMatchers(group)
                        : ccSourceScopedSilenceMatchers(row.lead.alert),
                    )
                  }
                  deliveryFact={
                    <DeliveryFact
                      matchedRoutes={row.lead.matchedRoutes}
                      channelsByReceiver={channelsByReceiver}
                    />
                  }
                >
                  <InstanceDetail
                    inst={row.lead}
                    silencePending={silenceInstance.isPending}
                    onSilence={(hours) =>
                      silenceInstance.mutate({
                        alert: row.lead.alert,
                        hours,
                      })
                    }
                    onCustomSilence={() =>
                      onCustomSilence(
                        ccSourceScopedSilenceMatchers(row.lead.alert),
                      )
                    }
                  />
                </InstanceRow>
              ));
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
                        {/* Not LineActions: this header has no expanded
                            detail, so its action must stay visible on touch. */}
                        <span className="ml-auto flex shrink-0 items-center">
                          <button
                            type="button"
                            aria-label={`Silence everything under ${group.name}`}
                            title="Silence all"
                            onClick={() =>
                              onCustomSilence(ccGroupSilenceMatchers(group))
                            }
                            className={lineActionClass}
                          >
                            <BellOff />
                          </button>
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
  );
}
