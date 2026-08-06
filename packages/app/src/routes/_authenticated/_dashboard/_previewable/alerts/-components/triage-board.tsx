// Every group here is firing: the route filters via alertingFiringGroups.

import { Button, buttonVariants } from "@everr/ui/components/button";
import { Card, CardContent } from "@everr/ui/components/card";
import { RelativeTime } from "@everr/ui/components/relative-time";
import { Skeleton } from "@everr/ui/components/skeleton";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BellOff,
  BookOpenText,
  ChevronRight,
  FileSearch,
  LoaderCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { alertingQueries } from "@/data/alerting/queries";
import {
  createAlertingSilence,
  deleteAlertingSilence,
} from "@/data/alerting/server";
import {
  alertingDeliveryFanout,
  alertingGroupSilenceMatchers,
  alertingInstanceIsUndeliverable,
  alertingInstanceLogsSearch,
  alertingRowBudget,
  alertingRunbookParams,
  alertingSourceScopedSilenceMatchers,
  TRIAGE_EVENT_RANGE,
  type TriageGroup,
  type TriageInstance,
  type TriageRow,
} from "@/data/alerting/triage";
import type {
  AlertingAlert,
  AlertingMatcher,
  AlertingRoute,
  AlertingSloStatusPayload,
} from "@/data/alerting/types";
import { alertingEventStatus } from "@/data/alerts/event-types";
import { fromAlertingRule } from "@/data/alerts/mapping";
import { parseResourceName } from "@/data/as-code/identity";
import { AlertingBudgetBar, alertingFmtBurn } from "./budget-bar";
import {
  AlertingSeverityBadge,
  AlertingStatusDot,
  AlertingTableSkeleton,
  alertingErrorMessage,
  alertingFormatTs,
  Conditions,
  EvidenceChips,
  LabelSet,
  Pill,
} from "./shared";
import type { SilenceDrawerOptions } from "./silences-panel";

// The expanded row needs the newest evidence-carrying event plus the last 6
// transitions; 100 is generous headroom.
const TRIAGE_INSTANCE_EVENT_LIMIT = 100;

// Shared fact-column widths in wide board containers: merged lines and sub-rows both use them,
// so the facts align down the whole card.
const COL_VALUE = "@[44rem]/triage:w-20";
const COL_BUDGET = "@[44rem]/triage:w-28";
const COL_SINCE = "@[44rem]/triage:w-20";
const COL_DELIVERY = "@[44rem]/triage:w-48";

function rowStartedAt(row: TriageRow): number {
  const time = row.lead.alert.active_since;
  return time ? new Date(time).getTime() : 0;
}

// ── Delivery fact ─────────────────────────────────────────────────────────────

function DeliveryFact({
  directChannels,
  matchedRoutes,
  channelsByReceiver,
}: {
  directChannels: string[];
  matchedRoutes: AlertingRoute[];
  channelsByReceiver: Map<string, string[]>;
}) {
  if (directChannels.length > 0) {
    const shown = directChannels.slice(0, 2);
    const names =
      shown.join(", ") +
      (directChannels.length > shown.length
        ? ` +${directChannels.length - shown.length}`
        : "");
    return (
      <span
        className="truncate font-mono text-xs text-muted-foreground"
        title={`Explicit destination: ${directChannels.join(", ")}`}
      >
        <span aria-hidden>→ </span>
        <span className="text-foreground">{names}</span>
      </span>
    );
  }
  if (matchedRoutes.length === 0) {
    return (
      <Link
        to="/alerts/delivery"
        hash="routes"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "inline-flex min-h-11 items-center whitespace-nowrap text-xs underline-offset-2 hover:underline @[44rem]/triage:min-h-0",
          toneText({ tone: "warning" }),
        )}
      >
        Not delivered
      </Link>
    );
  }
  const { receivers, channels, dead } = alertingDeliveryFanout(
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
          "inline-flex min-h-11 items-center whitespace-nowrap text-xs underline-offset-2 hover:underline @[44rem]/triage:min-h-0",
          toneText({ tone: "warning" }),
        )}
      >
        {names} · no channels
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
    alertingQueries.eventHistory(TRIAGE_EVENT_RANGE, {
      fingerprint: alert.key,
      limit: TRIAGE_INSTANCE_EVENT_LIMIT,
    }),
  );
  const own = ownEvents.data ?? [];
  const latest = own.find(
    (e) => e.evidence && Object.keys(e.evidence).length > 0,
  );
  const transitions = own
    .filter((e) => alertingEventStatus(e.eventType) !== null)
    .slice(0, 6);
  const runbook = alertingRunbookParams(rule);
  const description = rule ? fromAlertingRule(rule).displayDescription : null;

  return (
    <div className="space-y-3 border-t border-border/60 bg-muted/10 px-3 py-3 pl-9">
      {description && (
        <p className="max-w-prose text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {latest?.evidence && (
        <div className="space-y-1">
          <div className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
            Evidence
          </div>
          <EvidenceChips
            evidence={latest.evidence}
            truncated={latest.evidenceTruncated}
          />
        </div>
      )}

      <div className="space-y-1">
        <div className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
          Delivery
        </div>
        {inst.directChannels.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Explicit channels</span>
            <span className="font-mono text-foreground">
              {inst.directChannels.join(", ")}
            </span>
          </div>
        ) : inst.matchedRoutes.length === 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              No delivery route matches this alert.
            </span>
            <Link
              to="/alerts/delivery"
              hash="routes"
              className="inline-flex min-h-11 items-center font-medium text-foreground underline-offset-2 hover:underline @[44rem]/triage:min-h-0"
            >
              Configure delivery
            </Link>
          </div>
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
        <div className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
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
                <AlertingStatusDot
                  tone={
                    alertingEventStatus(e.eventType) === "firing"
                      ? "danger"
                      : "muted"
                  }
                />
                <span className="w-14 text-muted-foreground">
                  {alertingEventStatus(e.eventType) ?? e.eventType}
                </span>
                <RelativeTime
                  timestamp={e.timestamp}
                  className="text-muted-foreground/80"
                  title={alertingFormatTs(e.timestamp)}
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
        <span className="pr-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
          Silence
        </span>
        {[1, 8, 24].map((h) => (
          <Button
            key={h}
            variant="outline"
            size="sm"
            className="min-h-11 min-w-11 @[44rem]/triage:min-h-7"
            disabled={silencePending}
            onClick={() => onSilence(h)}
          >
            {h}h
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 px-3 @[44rem]/triage:min-h-7"
          disabled={silencePending}
          onClick={onCustomSilence}
        >
          Custom
        </Button>
        {silencePending && (
          <span
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            role="status"
          >
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            Silencing
          </span>
        )}
        {runbook && (
          <Link
            to="/runbooks/$project/$slug"
            params={runbook}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "min-h-11 @[44rem]/triage:min-h-7",
            )}
          >
            <BookOpenText data-icon="inline-start" />
            Runbook
          </Link>
        )}
        <Link
          to="/logs"
          search={alertingInstanceLogsSearch(alert)}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "min-h-11 @[44rem]/triage:min-h-7",
          )}
        >
          <FileSearch data-icon="inline-start" />
          View logs
        </Link>
      </div>
    </div>
  );
}

// ── Line building blocks ──────────────────────────────────────────────────────

// Hidden in narrow board containers: the expanded detail carries every action, which is the
// touch path.
function LineActions({ children }: { children: React.ReactNode }) {
  return (
    // Fixed width: the runbook shortcut exists only on some rows, and a
    // shrinking slot would knock the fact columns out of alignment.
    <span className="hidden shrink-0 items-center justify-end gap-0.5 @[44rem]/triage:flex @[44rem]/triage:w-14">
      {children}
    </span>
  );
}

const lineActionClass =
  "flex size-11 shrink-0 items-center justify-center rounded text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:text-foreground focus-visible:outline-primary @[44rem]/triage:size-7 [&_svg]:size-3.5";

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
        "flex shrink-0 flex-col whitespace-nowrap @[44rem]/triage:items-end",
        col,
        className,
      )}
      title={title}
    >
      <span className="truncate text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
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
            className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline-offset-2 hover:underline @[44rem]/triage:min-h-0"
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
          className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline-offset-2 hover:underline @[44rem]/triage:min-h-0"
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
        className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 transition-colors duration-150 hover:bg-muted/40 @[44rem]/triage:flex-nowrap @[44rem]/triage:gap-y-0.5 @[44rem]/triage:pb-2.5"
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${rowName}`}
          onClick={onToggle}
          className="flex size-11 shrink-0 items-center justify-center rounded text-muted-foreground outline-2 outline-dotted outline-transparent transition-colors duration-150 hover:text-foreground focus-visible:outline-primary @[44rem]/triage:size-7"
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
        <span className="basis-full @[44rem]/triage:hidden" aria-hidden />
        {/* Rule rows keep the empty budget slot in wide containers so the grid holds. */}
        {isSlo ? (
          <FactCell
            col={COL_BUDGET}
            className="pl-14 @[44rem]/triage:pl-0"
            label="budget left"
            title="Error budget remaining"
          >
            {/* `hang` keeps the figure on the shared value line, the meter
                tucked into the row padding above. */}
            <AlertingBudgetBar remaining={budget} hang className="w-24" />
          </FactCell>
        ) : (
          <span
            aria-hidden
            className={cn("hidden shrink-0 @[44rem]/triage:block", COL_BUDGET)}
          />
        )}
        {/* Merged rows show the lead tier's rate and the rest in the tooltip. */}
        <FactCell
          col={COL_VALUE}
          className={isSlo ? undefined : "pl-14 @[44rem]/triage:pl-0"}
          label={isSlo ? "burn rate" : (valueLabel ?? "value")}
          title={
            isSlo && row.members.length > 1
              ? `burn rate — ${perTierRates}`
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
          <span className="text-xs text-muted-foreground">
            {activeSince ? <RelativeTime timestamp={activeSince} /> : "—"}
          </span>
        </FactCell>
        {/* Its own line in narrow containers: clipping delivery status can
            assert the opposite of the truth. */}
        <span
          className={cn(
            "flex min-w-0 basis-full items-center gap-2 overflow-hidden pl-14 @[44rem]/triage:basis-auto @[44rem]/triage:pl-0 @[44rem]/triage:flex-none @[44rem]/triage:justify-end",
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
      scopeLabel: group.name,
      affectedCount: (row ? row.members : group.rows.flatMap((r) => r.members))
        .length,
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
  const shownGroups = [...groups].sort(
    (a, b) =>
      (SEVERITY_PRIORITY[a.severity] ?? 3) -
        (SEVERITY_PRIORITY[b.severity] ?? 3) ||
      Number(b.rows.some(rowIsUnrouted)) - Number(a.rows.some(rowIsUnrouted)) ||
      rowStartedAt(b.rows[0]) - rowStartedAt(a.rows[0]) ||
      a.name.localeCompare(b.name),
  );
  const silenceInstance = useMutation({
    mutationFn: ({ alert, hours }: { alert: AlertingAlert; hours: number }) => {
      // One clock read: two would let the window straddle a millisecond and
      // come out at hours + 1ms.
      const now = Date.now();
      return createAlertingSilence({
        data: {
          matchers: alertingSourceScopedSilenceMatchers(alert),
          starts_at: new Date(now).toISOString(),
          ends_at: new Date(now + hours * 3_600_000).toISOString(),
          comment: `silenced from triage (${hours}h)`,
        },
      });
    },
    onSuccess: (created, { hours }) => {
      qc.invalidateQueries({ queryKey: alertingQueries.silences().queryKey });
      toast.success(`Silenced for ${hours}h`, {
        action: {
          label: "Undo",
          onClick: () => {
            void deleteAlertingSilence({ data: { id: created.id } })
              .then(() => {
                qc.invalidateQueries({
                  queryKey: alertingQueries.silences().queryKey,
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
              reaching no one
            </p>
          </div>
          <Link
            to="/alerts/delivery"
            className={cn(
              buttonVariants({ variant: "default" }),
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
                Firing instances appear here the moment a rule&rsquo;s query
                returns rows.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {shownGroups.map((group) => {
                const merged = group.rows.length === 1;
                const rows = group.rows.map((row) => (
                  <InstanceRow
                    key={row.lead.alert.key}
                    row={row}
                    group={group}
                    budget={
                      group.sloId !== undefined
                        ? alertingRowBudget(sloStatuses.get(group.sloId))
                        : null
                    }
                    expanded={expandedKey === row.lead.alert.key}
                    onToggle={() =>
                      setExpandedKey((k) =>
                        k === row.lead.alert.key ? null : row.lead.alert.key,
                      )
                    }
                    onGroupSilence={() => {
                      onCustomSilence(
                        ...silenceSeed(group, merged ? undefined : row),
                      );
                    }}
                    deliveryFact={
                      <DeliveryFact
                        directChannels={row.lead.directChannels}
                        matchedRoutes={row.lead.matchedRoutes}
                        channelsByReceiver={channelsByReceiver}
                      />
                    }
                  >
                    <InstanceDetail
                      inst={row.lead}
                      silencePending={
                        silenceInstance.isPending &&
                        silenceInstance.variables?.alert.key ===
                          row.lead.alert.key
                      }
                      onSilence={(hours) =>
                        silenceInstance.mutate({
                          alert: row.lead.alert,
                          hours,
                        })
                      }
                      onCustomSilence={() => {
                        onCustomSilence(...silenceSeed(group, row));
                      }}
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
                              onClick={() => {
                                onCustomSilence(...silenceSeed(group));
                              }}
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
    </div>
  );
}
