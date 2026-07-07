// packages/app/src/components/cc/alert-event-feed.tsx
// Self-contained stored+live merged event feed: stored CC history from
// ClickHouse layered under the live SSE tail. Mounted unscoped (home Activity
// tab) or scoped to one alert (`scopeSlug`, e.g. the detail timeline).
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import type { TimeRange } from "@everr/ui/lib/time-range";
import { cn } from "@everr/ui/lib/utils";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Pause, Play, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { listCcEventHistory } from "@/data/cc/server";
import {
  type CcUnifiedEvent,
  historyToUnified,
  liveToUnified,
  mergeCcEvents,
} from "@/data/cc/unified-events";
import { useCcEvents } from "@/hooks/use-cc-events";
import { useTimeRange } from "@/hooks/use-time-range";
import {
  CcConnectionBadge,
  CcEmptyState,
  CcEventStatusBadge,
  CcSeverityBadge,
  CcStatusDot,
  CcTableSkeleton,
  ccErrorMessage,
  ccFormatTs,
  EvidenceChips,
  LabelSet,
} from "./shared";

const SEVERITY_LABELS: Record<string, string> = {
  all: "All severities",
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

// The real alert.event_type values CC writes (unified-events' liveToUnified/
// historyToUnified and history.server.ts's readers): instance fire/resolve,
// notification delivery, rule evaluation health, and dispatcher mutes.
const EVENT_TYPE_LABELS: Record<string, string> = {
  all: "All types",
  instance_fired: "Fired",
  instance_resolved: "Resolved",
  delivery: "Delivery",
  rule_health: "Rule health",
  silenced: "Silenced",
};

const HISTORY_LIMIT = 200;

// The coarse lens over the fine event-type filter: each entry names the
// event_type values it admits (null = no narrowing). Real engine vocabulary
// only — transitions are instance fire/resolve, deliveries are dispatcher
// sends, silence audits are the dispatcher's silenced-drop records.
const TYPE_LENSES = [
  { key: "all", label: "All", types: null },
  {
    key: "transitions",
    label: "Transitions",
    types: ["instance_fired", "instance_resolved"],
  },
  { key: "deliveries", label: "Deliveries", types: ["delivery"] },
  { key: "silence_audits", label: "Silence audits", types: ["silenced"] },
] as const;

type TypeLensKey = (typeof TYPE_LENSES)[number]["key"];

export const ccEventHistoryQueryOptions = (timeRange: TimeRange) =>
  queryOptions({
    queryKey: ["cc", "event-history", timeRange],
    queryFn: () =>
      listCcEventHistory({ data: { limit: HISTORY_LIMIT, timeRange } }),
  });

export function AlertEventFeed({
  scopeSlug,
  className,
  showTypeLens = false,
  hideRuleColumns = false,
  resolveRuleName,
  resolveRuleSeverity,
}: {
  /**
   * Scope the feed to one rule. Event rows carry the rule's slug when CC
   * knows it and the bare rule id otherwise, so callers that know both pass
   * both and either handle matches.
   */
  scopeSlug?: string | readonly string[];
  className?: string;
  /** Render the coarse All/Transitions/Deliveries/Silence-audits lens. */
  showTypeLens?: boolean;
  /**
   * Drop the Severity and Rule columns and the severity filter. Every row in
   * a single-rule scoped feed shares the same rule, so those columns are
   * constant noise; callers scoping to one rule (e.g. the rule detail page)
   * pass this.
   */
  hideRuleColumns?: boolean;
  /**
   * Map a row's rule handle (slug or bare rule id) to a display name. Rows the
   * resolver leaves unchanged render the handle as before.
   */
  resolveRuleName?: (handle: string) => string;
  /**
   * Map a row's rule handle to that rule's severity, used when the event
   * itself carries none. Stored history doesn't stamp `alert.severity` on
   * every event kind yet, so this only backs the events a rule's severity
   * actually describes (fire/resolve transitions, via `status`); other kinds
   * still render "—" for severity.
   */
  resolveRuleSeverity?: (handle: string) => string | undefined;
}) {
  const { events, connected, clear, setPaused } = useCcEvents();
  const [paused, setLocalPaused] = useState(false);
  const [severity, setSeverity] = useState<string>("all");
  const [eventType, setEventType] = useState<string>("all");
  const [typeLens, setTypeLens] = useState<TypeLensKey>("all");
  const { timeRange } = useTimeRange();
  const history = useQuery(ccEventHistoryQueryOptions(timeRange));

  // Live SSE frames layered over stored history, deduped on (fingerprint,
  // eval second, event type) with the live frame winning. Bounded memory: the
  // live buffer caps at 500, the history page at 200, the merged list at 700.
  const merged = useMemo(
    () =>
      mergeCcEvents(
        events.map(liveToUnified),
        (history.data ?? []).map(historyToUnified),
      ),
    [events, history.data],
  );

  const scoped = useMemo(() => {
    if (!scopeSlug) return merged;
    const handles = new Set(
      typeof scopeSlug === "string" ? [scopeSlug] : scopeSlug,
    );
    return merged.filter((e) => handles.has(e.rule));
  }, [merged, scopeSlug]);

  // Stored history doesn't stamp severity on every event kind yet (see
  // AlertEventLogRow.severity), so a fire/resolve transition missing its own
  // severity falls back to its rule's — `status` is only set on transitions,
  // so other event kinds (delivery, rule health, silence audits) are left as
  // a genuine gap and still render "—".
  const eventSeverity = useMemo(
    () => (e: CcUnifiedEvent) =>
      e.severity ??
      (e.status !== null ? (resolveRuleSeverity?.(e.rule) ?? null) : null),
    [resolveRuleSeverity],
  );

  // Lens, event-type, and severity compose with AND: each narrows
  // independently of the others ("all" is a no-op filter on that axis).
  const lensTypes = TYPE_LENSES.find((l) => l.key === typeLens)?.types ?? null;
  const filtered = useMemo(
    () =>
      scoped
        .filter(
          (e) =>
            lensTypes === null ||
            (lensTypes as readonly string[]).includes(e.eventType),
        )
        .filter((e) => eventType === "all" || e.eventType === eventType)
        .filter((e) => severity === "all" || eventSeverity(e) === severity),
    [scoped, lensTypes, eventType, severity, eventSeverity],
  );

  const allColumns: Column<CcUnifiedEvent>[] = [
    {
      header: "Time",
      cell: (e) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {e.source === "live" ? (
            <span title="arrived over the live stream">
              <CcStatusDot tone="live" />
            </span>
          ) : (
            // Keeps live and stored timestamps horizontally aligned.
            <span className="inline-flex size-1.5 shrink-0" aria-hidden />
          )}
          {ccFormatTs(e.ts)}
        </span>
      ),
    },
    {
      header: "Event",
      cell: (e) => (
        <span className="inline-flex items-center gap-1.5">
          {e.status ? (
            <CcEventStatusBadge status={e.status} />
          ) : (
            <span className="text-xs text-muted-foreground">{e.eventType}</span>
          )}
          {e.suppressed && (
            <span className="text-[0.6875rem] text-muted-foreground/70">
              suppressed
            </span>
          )}
        </span>
      ),
    },
    {
      header: "Severity",
      cell: (e) => {
        const severity = eventSeverity(e);
        return severity ? (
          <CcSeverityBadge severity={severity} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      },
    },
    {
      header: "Labels",
      cell: (e) => (
        <div className="flex flex-col gap-1">
          <LabelSet labels={e.labels} />
          <EvidenceChips
            evidence={e.evidence}
            truncated={e.evidenceTruncated}
          />
        </div>
      ),
    },
    {
      header: "Rule",
      cell: (e) => {
        const name = resolveRuleName ? resolveRuleName(e.rule) : e.rule;
        return (
          <span
            className="inline-block max-w-44 truncate align-bottom font-mono text-xs"
            title={name === e.rule ? e.rule : `${name} (${e.rule})`}
          >
            {name}
          </span>
        );
      },
    },
  ];

  // A feed scoped to one rule shows the same rule and (once resolved) the
  // same severity on every row: constant noise, so hideRuleColumns drops both.
  const columns = hideRuleColumns
    ? allColumns.filter((c) => c.header !== "Severity" && c.header !== "Rule")
    : allColumns;

  return (
    <Card inset="flush-content" className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Event stream
          <CcConnectionBadge connected={connected} />
        </CardTitle>
        <CardDescription>
          New events stream in live (dotted rows); earlier ones are read from
          ClickHouse for the selected time range. Newest 700 kept.
        </CardDescription>
        <CardAction>
          <div className="flex items-center gap-1.5">
            <Select
              value={eventType}
              onValueChange={(v) => setEventType(v ?? "all")}
            >
              <SelectTrigger size="sm" className="w-36" aria-label="Event type">
                <SelectValue>
                  {(v) => EVENT_TYPE_LABELS[v as string] ?? "All types"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="instance_fired">Fired</SelectItem>
                <SelectItem value="instance_resolved">Resolved</SelectItem>
                <SelectItem value="delivery">Delivery</SelectItem>
                <SelectItem value="rule_health">Rule health</SelectItem>
                <SelectItem value="silenced">Silenced</SelectItem>
              </SelectContent>
            </Select>
            {!hideRuleColumns && (
              <Select
                value={severity}
                onValueChange={(v) => setSeverity(v ?? "all")}
              >
                <SelectTrigger size="sm" className="w-36" aria-label="Severity">
                  <SelectValue>
                    {(v) => SEVERITY_LABELS[v as string] ?? "All severities"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All severities</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const p = !paused;
                setLocalPaused(p);
                setPaused(p);
              }}
            >
              {paused ? (
                <Play data-icon="inline-start" />
              ) : (
                <Pause data-icon="inline-start" />
              )}
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clear}
              disabled={events.length === 0}
            >
              <Trash2 data-icon="inline-start" />
              Clear live
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {showTypeLens && (
          <div className="px-3 pb-3">
            <div
              role="tablist"
              aria-label="Event kind"
              className="inline-flex rounded-md border border-border bg-muted/20 p-0.5"
            >
              {TYPE_LENSES.map((lens) => {
                const active = typeLens === lens.key;
                return (
                  <button
                    key={lens.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setTypeLens(lens.key)}
                    className={cn(
                      "rounded-[0.3rem] px-3 py-1 text-xs font-medium outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] focus-visible:outline-primary",
                      active
                        ? "bg-card text-foreground ring-1 ring-foreground/10"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {lens.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {history.isError && (
          <div className="px-3 pb-2 text-xs text-destructive">
            Stored history unavailable ({ccErrorMessage(history.error)}); the
            live tail is still running.
          </div>
        )}
        {history.isPending && merged.length === 0 ? (
          <CcTableSkeleton rows={6} />
        ) : (
          <DataTable
            data={filtered}
            columns={columns}
            rowKey={(e, i) => `${e.source}-${e.key}-${i}`}
            emptyState={
              <CcEmptyState
                icon={paused ? Pause : undefined}
                title={
                  paused
                    ? "Stream paused"
                    : severity === "all"
                      ? "No events in range"
                      : `No ${severity} events`
                }
                hint={
                  paused
                    ? "Resume to keep tailing live events. Stored history stays put."
                    : severity === "all"
                      ? "Live events appear in real time; stored events load for the selected time range."
                      : "Stored events carry no severity yet, so this filter matches live frames only."
                }
              />
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
