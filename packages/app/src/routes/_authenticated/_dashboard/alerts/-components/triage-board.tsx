// The triage board: one tight line per problem, firing only — pending and
// inactive instances are counted by the pipeline strip above but are not what
// triage acts on (the route filters via ccFiringGroups). A source with a
// single instance collapses header and row into one line (the common case:
// name, severity, labels, value, age, delivery, all on one baseline); a source
// with several instances keeps a slim header with one line per label set under
// it. The fact columns (budget, value, age, delivery) share fixed widths
// across the whole card, so every group reads on the same grid without
// per-group column headers. Each line carries its actions at the right edge
// (md+); the expanded detail carries the full set, which is also the touch
// path.
// SLO rows pair their burn rate with the row's own error budget remaining
// (matched by label set, not the SLO's worst group); spent budgets as a
// standing state live on the exhausted-budgets card below the board. The
// board owns the UI state and the quick-silence mutation that only it uses.
// What it takes from the route is the resolved data, plus one callback for
// the custom-silence drawer, which the route shares with the silences panel
// below.

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

// Per-instance cap for the expanded row's fingerprint-scoped feed: it needs
// the newest evidence-carrying event plus the last 6 transitions, so this is
// generous headroom.
const TRIAGE_INSTANCE_EVENT_LIMIT = 100;

// The shared fact-column widths (md+). Merged lines and sub-rows both use
// them, so values, budgets, ages, and delivery facts align down the whole
// card.
// Sized to its content ("BURN RATE" caption over "1000.0×"): the budget
// column sits directly to its left, and slack here would read as a hole
// between the two.
const COL_VALUE = "md:w-20";
const COL_BUDGET = "md:w-28";
const COL_SINCE = "md:w-20";
const COL_DELIVERY = "md:w-48";

// ── Delivery fact ─────────────────────────────────────────────────────────────

function DeliveryFact({
  matchedRoutes,
  channelsByReceiver,
  hasSubscribers,
}: {
  matchedRoutes: CcRoute[];
  channelsByReceiver: Map<string, string[]>;
  hasSubscribers: boolean;
}) {
  if (matchedRoutes.length === 0) {
    return (
      <Link
        to="/alerts/delivery"
        hash="firehose"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "whitespace-nowrap text-xs underline-offset-2 hover:underline",
          toneText({ tone: "warning" }),
        )}
      >
        {hasSubscribers
          ? "not routed · firehose only"
          : "not routed · no subscribers"}
      </Link>
    );
  }
  // The receiver is the routing fact; which channels it fans out to is
  // delivery detail, kept on the tooltip instead of cluttering the row.
  const { receivers, channels, dead } = ccDeliveryFanout(
    matchedRoutes,
    channelsByReceiver,
  );
  // Overflow as an honest "+N" instead of CSS truncation, which can chop a
  // receiver name mid-word. The full list stays on the tooltip.
  const shown = receivers.slice(0, 2);
  const names =
    shown.join(", ") +
    (receivers.length > shown.length
      ? ` +${receivers.length - shown.length}`
      : "");
  if (channels.length === 0) {
    // Routed, but every matched receiver fans out to zero channels: the
    // notification reaches no one, which is the "not routed" trap wearing a
    // receiver name. Same warning treatment, linked to where to fix it.
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
  // This instance's own stored events, fetched (and polled) only while the
  // row is expanded — the fingerprint narrows server-side, so the board never
  // ships the whole 24h window for one row's detail.
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
            no route matches — delivery falls through to the firehose
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
                    ccEventStatus(e.eventType) === "firing"
                      ? "firing"
                      : "resolved"
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
        {/* The diagnose edge: from "I'm paged" into the telemetry that fired,
            scoped to the instance's window (and service, when it has one). */}
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

// The action cluster at a line's right edge. Hidden below md: phone rows
// have no room for it, and the expanded detail already carries every action,
// which is the touch path.
function LineActions({ children }: { children: React.ReactNode }) {
  return (
    // Fixed width (two icons' worth): a runbook shortcut exists only on
    // some rows, and letting the slot shrink would knock the fact columns
    // out of alignment between neighboring lines.
    <span className="hidden shrink-0 items-center justify-end gap-0.5 md:flex md:w-14">
      {children}
    </span>
  );
}

const lineActionClass =
  "flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:text-foreground focus-visible:outline-primary [&_svg]:size-3.5";

/**
 * One stacked fact: a micro-label over its value, the pipeline strip's
 * readout idiom. The label makes each column self-describing on a card that
 * mixes rules and SLOs, without resurrecting per-group header rows.
 */
function FactCell({
  col,
  label,
  title,
  className,
  children,
}: {
  /** The column's shared width class, so the grid holds across rows. */
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

/** The source's identity: name (linked when the listing resolved), SLO origin
 *  marker, severity. Shared by the merged line and the multi-row header. */
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
        // Origin marker: this group is an SLO's burn-rate alerting, not a
        // rule's.
        <Pill className="text-muted-foreground">SLO</Pill>
      )}
      <CcSeverityBadge severity={group.severity} />
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
  // One-instance source: this line carries the group identity too, and its
  // silence action mutes the whole source (labels included — for a single
  // instance the two scopes cover the same thing).
  const merged = group.rows.length === 1;
  // The value column's name, printed as the cell's micro-label. Null for SLO
  // rows (the ×-suffixed burn rate names itself) and unnamed rule values.
  const valueLabel =
    group.sloId !== undefined ? null : (group.rule?.spec.value_column ?? null);
  const runbook = ccRunbookParams(inst.rule);
  // SLO rows surface every firing burn-rate tier as a first-class badge (each
  // toned by the severity it fires at) instead of leaving them buried in the
  // label pills, or split across a row apiece.
  const isSlo = inst.slo !== undefined || alert.slo !== undefined;
  const shownLabels = isSlo
    ? Object.fromEntries(
        Object.entries(alert.labels).filter(([k]) => k !== "slo_tier"),
      )
    : alert.labels;
  // What to call this row out loud. Its labels are what distinguish it from
  // its siblings, so they make the accessible name. A merged line without
  // labels is the source itself, so its name is the distinguishing fact —
  // two scalar SLOs both firing "ticket" must not announce identically. A
  // label-free sub-row falls back to its firing tiers. "Expand
  // service=checkout" beats five buttons all announcing "Expand row".
  const rowName =
    Object.entries(shownLabels)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ") || (merged ? group.name : row.tiers.join(", ") || "row");
  // How long this has been wrong, across every tier that reported it — not
  // just how long the leading tier has been the leading one.
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
      {/* Mouse convenience on the line; the chevron button is the keyboard and
          screen-reader target (same split as DataTable's onRowClick idiom). */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the chevron button is the keyboard target */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: mouse convenience only */}
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a,button") !== null) return;
          onToggle();
        }}
        // items-center: the one-line clusters (name, delivery fact, actions)
        // sit at the row's vertical middle. The fact cells all share the same
        // two-line height (the budget meter hangs out of flow), so centering
        // still keeps their micro-labels on one line and their values on
        // another across the whole row.
        // md:pb-2.5: room under the fact cells for the budget meter's hang,
        // so it clears the row divider.
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
          {/* No per-tier badges: which sensitivities tripped is detail, not
              triage. The group severity above already says how bad, the value
              column says how fast, and the tier names survive on the merged
              value's tooltip and the SLO detail page. A merged line with no
              labels needs no placeholder either: the name is already on it. */}
          {(Object.keys(shownLabels).length > 0 || !merged) && (
            <LabelSet labels={shownLabels} emptyLabel="no labels" />
          )}
        </span>
        {/* Below md the fact columns wrap onto their own line (phone widths
            can't fit labels + value + age + delivery side by side); this
            breaker forces the wrap, and the pl-8 lines the second row up
            under the content column. */}
        <span className="basis-full md:hidden" aria-hidden />
        {/* The budget leads the fact columns: how much is left is the SLO's
            headline state, the burn rate beside it says how fast it is going.
            Rule rows keep the empty slot on md+ so the grid holds, and drop
            it on the phone's stacked facts line. */}
        {isSlo ? (
          <FactCell
            col={COL_BUDGET}
            className="pl-8 md:pl-0"
            label="budget left"
            title="Error budget remaining"
          >
            {/* `hang` keeps the figure on the shared value line, the meter
                tucked below it into the row padding (md:pb-2.5 above). */}
            <CcBudgetBar remaining={budget} hang className="w-24" />
          </FactCell>
        ) : (
          <span
            aria-hidden
            className={cn("hidden shrink-0 md:block", COL_BUDGET)}
          />
        )}
        {/* SLO rows carry the tier's burn rate as their value: print it at
            the engine's own precision (one decimal, ×) instead of the raw
            float. A merged row shows its leading tier's rate, with every
            tier's rate on the tooltip so the others are not lost. */}
        <FactCell
          col={COL_VALUE}
          // The mobile facts line indents its first cell under the content
          // column; on SLO rows the budget cell above leads instead.
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
        {/* Every row here is firing, so the label doubles as the state
            announcement: a bare "12h ago" would read as easily as "last
            evaluated". */}
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
        {/* Its own line below md: squeezed between the other facts it would
            clip from the left, and "not routed" clipped to "routed" asserts
            the opposite of the truth. */}
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
          {/* On a merged line the silence mutes the whole source (and keeps
              the header action's accessible name); a sub-row's silence pins
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
  hasSubscribers,
  sloStatusGroups,
  watchingRules,
  lastEventTs,
  eventsUnavailable,
  onCustomSilence,
}: {
  groups: TriageGroup[];
  pending: boolean;
  channelsByReceiver: Map<string, string[]>;
  hasSubscribers: boolean;
  /** Each SLO's status groups, for the per-row budget readout. */
  sloStatusGroups: Map<string, CcSloGroupStatus[]>;
  /** For the all-clear readout: how many rules are unpaused. */
  watchingRules: number;
  /** For the all-clear readout: timestamp of the newest stored event. */
  lastEventTs: string | null;
  /**
   * Whether the event read failed. A failed read is not "no events": on an
   * all-clear card that distinction is the whole point, since silence from a
   * broken pipeline looks exactly like silence from a healthy one.
   */
  eventsUnavailable: boolean;
  /**
   * Opens the create drawer seeded with these matchers. Stays a prop because
   * the drawer is shared with the silences panel outside this board.
   */
  onCustomSilence: (matchers: CcMatcher[]) => void;
}) {
  // One row open at a time, and nothing outside the board cares which.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const qc = useQueryClient();
  // The quick-silence buttons live in this board's rows and nowhere else, so
  // the mutation lives here too, as SilencesPanel and the builders do.
  const silenceInstance = useMutation({
    mutationFn: ({ alert, hours }: { alert: CcAlert; hours: number }) =>
      createCcSilence({
        data: {
          matchers: ccSourceScopedSilenceMatchers(alert),
          starts_at: new Date().toISOString(),
          ends_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
          comment: `silenced from triage (${hours}h)`,
        },
      }),
    onSuccess: (_, { hours }) => {
      qc.invalidateQueries({ queryKey: ccQueries.silences().queryKey });
      toast.success(`Silenced for ${hours}h`);
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  // Each SLO's status groups keyed for O(1) row lookups, rebuilt only when
  // the overlaid map actually changes.
  const budgetIndexes = useMemo(
    () =>
      new Map(
        [...sloStatusGroups].map(([id, groups]) => [id, ccBudgetIndex(groups)]),
      ),
    [sloStatusGroups],
  );

  return (
    // role/label: the board is a landmark distinct from the silences panel
    // below, for assistive tech and scoped queries alike.
    <Card inset="flush-content" role="region" aria-label="Triage board">
      <CardContent>
        {pending ? (
          <CcTableSkeleton rows={6} />
        ) : groups.length === 0 ? (
          // Nothing to triage at all: the same all-clear instrument the
          // Firing lens used to show, now the board's only empty state.
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
                  // A merged line's silence covers the whole source: one
                  // review-and-create seeded with the synthetic scoping
                  // matcher (slo/rule), so a 30-row group is one silence
                  // instead of 30.
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
                      hasSubscribers={hasSubscribers}
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
                      // The create drawer lives on the page — a custom
                      // silence opens pre-seeded in place, no navigation.
                      onCustomSilence(
                        ccSourceScopedSilenceMatchers(row.lead.alert),
                      )
                    }
                  />
                </InstanceRow>
              ));
              return (
                // The section adds no padding of its own: the rows carry it,
                // so their hover highlight runs divider to divider, no seam.
                <section key={group.sourceId}>
                  {merged ? (
                    rows
                  ) : (
                    <>
                      <div className="flex items-center gap-2 px-3 pt-2 pb-0.5">
                        <GroupIdentity group={group} />
                        {/* No row count here: every row renders directly
                            below, uncapped, so the number only ever restates
                            what is already on screen. */}
                        {/* Not LineActions: rows can hide their shortcuts
                            below md because the expanded detail carries the
                            full set, but this header has no detail, so its
                            one action stays visible on touch too. */}
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
