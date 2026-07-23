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
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import {
  ALERT_EVENT_TYPES,
  type AlertEventType,
} from "@/data/alerts/event-types";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import { parseResourceName } from "@/data/as-code/identity";
import { ccQueries } from "@/data/cc/queries";
import { useTimeRange } from "@/hooks/use-time-range";
import {
  CcEmptyState,
  CcEventStatusBadge,
  CcSegmentedControl,
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

// Display labels for the engine's event-type vocabulary (ALERT_EVENT_TYPES);
// the Record keying keeps this exhaustive against it.
const EVENT_TYPE_LABELS: Record<AlertEventType, string> = {
  instance_fired: "Fired",
  instance_resolved: "Resolved",
  delivery: "Delivery",
  rule_health: "Rule health",
  silenced: "Silenced",
};

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
] as const satisfies readonly {
  key: string;
  label: string;
  types: readonly AlertEventType[] | null;
}[];

type TypeLensKey = (typeof TYPE_LENSES)[number]["key"];

/** firing/resolved for instance transitions; null for other event kinds. */
export function ccEventStatus(eventType: string): "firing" | "resolved" | null {
  return eventType === "instance_fired"
    ? "firing"
    : eventType === "instance_resolved"
      ? "resolved"
      : null;
}

export function AlertEventFeed({
  scopeSlug,
  showTypeLens = false,
  hideRuleColumns = false,
  resolveRuleName,
  resolveRuleSeverity,
  resolveSlo,
  resolveRuleAddress,
  timeRange: timeRangeProp,
}: {
  /**
   * Scope the feed to one rule. Event rows carry the rule's slug when CC
   * knows it and the bare rule id otherwise, so callers that know both pass
   * both and either handle matches.
   */
  scopeSlug?: readonly string[];
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
   * itself carries none. CC now stamps `alert.severity` on alert event logs,
   * so this only backs records stored before it did — and only for the
   * events a rule's severity actually describes (fire/resolve transitions);
   * other kinds still render "—" for severity.
   */
  resolveRuleSeverity?: (handle: string) => string | undefined;
  /**
   * Map a row's handle to its SLO when the event is SLO-originated (CC's
   * alert log resolves slugs the same way for both sources: the `everr.name`
   * annotation falling back to the source uuid). A hit renders the SLO's
   * name with an "SLO" origin marker instead of a rule handle; checked
   * before resolveRuleName. The SLO's first-class `name` ("project/slug")
   * is split into the link's slug-route params.
   */
  resolveSlo?: (handle: string) => { name: string } | undefined;
  /**
   * Map a row's rule handle to the rule's slug address. A hit turns the rule
   * name into a link to the rule detail page (resolveSlo hits already link
   * to the SLO); without it names render as plain text, as before.
   */
  resolveRuleAddress?: (
    handle: string,
  ) => { project: string; slug: string } | undefined;
  /**
   * Pin the feed to a fixed range instead of the global time-range picker.
   * The SLO detail page passes its window range so the feed matches the budget
   * chart above it; callers that omit it follow the global picker.
   */
  timeRange?: TimeRange;
}) {
  const [severity, setSeverity] = useState<string>("all");
  const [eventType, setEventType] = useState<string>("all");
  const [typeLens, setTypeLens] = useState<TypeLensKey>("all");
  const { timeRange: pickerRange } = useTimeRange();
  const timeRange = timeRangeProp ?? pickerRange;
  const history = useQuery(ccQueries.eventHistory(timeRange));

  const rows = history.data ?? [];

  const scoped = useMemo(() => {
    if (!scopeSlug) return rows;
    const handles = new Set(scopeSlug);
    return rows.filter((e) => handles.has(e.slug));
  }, [rows, scopeSlug]);

  // CC stamps severity on alert event logs, but records stored before it did
  // carry none (see AlertEventLogRow.severity): a fire/resolve transition
  // missing its own severity falls back to its rule's — transitions are the
  // only kinds a rule's severity describes, so other kinds (delivery, rule
  // health, silence audits) are left as a genuine gap and still render "—".
  const eventSeverity = useCallback(
    (e: AlertEventLogRow) =>
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
            (lensTypes as readonly AlertEventType[]).includes(e.eventType),
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
        // SLO-originated rows name their SLO with an origin marker; rule
        // rows keep the resolved rule name (or the raw handle). Resolved
        // sources link to their detail page — the feed is where "what
        // happened" turns into "go act on it".
        const slo = resolveSlo?.(e.slug);
        if (slo) {
          return (
            <span className="inline-flex max-w-44 items-center gap-1.5">
              <Link
                to="/alerts/slos/$project/$slug"
                params={parseResourceName(slo.name)}
                className="min-w-0 truncate font-mono text-xs underline-offset-2 hover:underline"
                title={`${slo.name} (${e.slug})`}
              >
                {slo.name}
              </Link>
              <span className="shrink-0 rounded-sm border border-border bg-muted/40 px-1 font-mono text-[0.625rem] leading-4 text-muted-foreground">
                SLO
              </span>
            </span>
          );
        }
        const name = resolveRuleName ? resolveRuleName(e.slug) : e.slug;
        const address = resolveRuleAddress?.(e.slug);
        if (address) {
          return (
            <Link
              to="/alerts/rules/$project/$slug"
              params={address}
              className="inline-block max-w-44 truncate align-bottom font-mono text-xs underline-offset-2 hover:underline"
              title={name === e.slug ? e.slug : `${name} (${e.slug})`}
            >
              {name}
            </Link>
          );
        }
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
    <Card inset="flush-content">
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
                  {(v) =>
                    v === "all"
                      ? "All types"
                      : EVENT_TYPE_LABELS[v as AlertEventType]
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {ALERT_EVENT_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {EVENT_TYPE_LABELS[value]}
                  </SelectItem>
                ))}
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
                  {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {showTypeLens && (
          <div className="px-3 pb-3">
            <CcSegmentedControl
              aria-label="Event kind"
              items={TYPE_LENSES}
              value={typeLens}
              onChange={setTypeLens}
            />
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
