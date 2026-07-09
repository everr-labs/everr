// packages/app/src/components/cc/alert-event-feed.tsx
// Stored CC event history from ClickHouse, polled to stay current. Mounted
// unscoped (the History page) or scoped to one alert (`scopeSlug`, e.g. the
// rule detail timeline).
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
import { useMemo, useState } from "react";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import { CC_POLL_INTERVAL_MS, listCcEventHistory } from "@/data/cc/server";
import { useTimeRange } from "@/hooks/use-time-range";
import {
  CcEmptyState,
  CcEventStatusBadge,
  CcSeverityBadge,
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

// The real alert.event_type values CC writes (history.server.ts's readers):
// instance fire/resolve, notification delivery, rule evaluation health, and
// dispatcher mutes.
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

/** firing/resolved for instance transitions; null for other event kinds. */
export function ccEventStatus(eventType: string): "firing" | "resolved" | null {
  return eventType === "instance_fired"
    ? "firing"
    : eventType === "instance_resolved"
      ? "resolved"
      : null;
}

export const ccEventHistoryQueryOptions = (timeRange: TimeRange) =>
  queryOptions({
    queryKey: ["cc", "event-history", timeRange],
    queryFn: () =>
      listCcEventHistory({ data: { limit: HISTORY_LIMIT, timeRange } }),
    refetchInterval: CC_POLL_INTERVAL_MS,
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
   * actually describes (fire/resolve transitions); other kinds still render
   * "—" for severity.
   */
  resolveRuleSeverity?: (handle: string) => string | undefined;
}) {
  const [severity, setSeverity] = useState<string>("all");
  const [eventType, setEventType] = useState<string>("all");
  const [typeLens, setTypeLens] = useState<TypeLensKey>("all");
  const { timeRange } = useTimeRange();
  const history = useQuery(ccEventHistoryQueryOptions(timeRange));

  const rows = history.data ?? [];

  const scoped = useMemo(() => {
    if (!scopeSlug) return rows;
    const handles = new Set(
      typeof scopeSlug === "string" ? [scopeSlug] : scopeSlug,
    );
    return rows.filter((e) => handles.has(e.slug));
  }, [rows, scopeSlug]);

  // Stored history doesn't stamp severity on every event kind yet (see
  // AlertEventLogRow.severity), so a fire/resolve transition missing its own
  // severity falls back to its rule's — transitions are the only kinds a
  // rule's severity describes, so other kinds (delivery, rule health, silence
  // audits) are left as a genuine gap and still render "—".
  const eventSeverity = useMemo(
    () => (e: AlertEventLogRow) =>
      e.severity ||
      (ccEventStatus(e.eventType) !== null
        ? (resolveRuleSeverity?.(e.slug) ?? null)
        : null),
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

  const allColumns: Column<AlertEventLogRow>[] = [
    {
      header: "Time",
      cell: (e) => (
        <span className="whitespace-nowrap">{ccFormatTs(e.timestamp)}</span>
      ),
    },
    {
      header: "Event",
      cell: (e) => {
        const status = ccEventStatus(e.eventType);
        return (
          <span className="inline-flex items-center gap-1.5">
            {status ? (
              <CcEventStatusBadge status={status} />
            ) : (
              <span className="text-xs text-muted-foreground">
                {e.eventType}
              </span>
            )}
            {e.suppressed && (
              <span className="text-[0.6875rem] text-muted-foreground/70">
                suppressed
              </span>
            )}
          </span>
        );
      },
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
        const name = resolveRuleName ? resolveRuleName(e.slug) : e.slug;
        return (
          <span
            className="inline-block max-w-44 truncate align-bottom font-mono text-xs"
            title={name === e.slug ? e.slug : `${name} (${e.slug})`}
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
        <CardTitle>Event history</CardTitle>
        <CardDescription>
          Alert events read from ClickHouse for the selected time range, newest
          first.
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
            Event history unavailable ({ccErrorMessage(history.error)}).
          </div>
        )}
        {history.isPending ? (
          <CcTableSkeleton rows={6} />
        ) : (
          <DataTable
            data={filtered}
            columns={columns}
            rowKey={(e, i) =>
              `${e.instanceFingerprint}-${e.timestamp}-${e.eventType}-${i}`
            }
            emptyState={
              <CcEmptyState
                title={
                  severity === "all"
                    ? "No events in range"
                    : `No ${severity} events`
                }
                hint={
                  severity === "all"
                    ? "Events appear here as rules fire, resolve, and deliver."
                    : "Only fire/resolve transitions carry a severity."
                }
              />
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
