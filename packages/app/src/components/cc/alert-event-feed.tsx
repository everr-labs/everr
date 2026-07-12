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
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import { renderInstanceMessage } from "@/data/alerts/template";
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

const HISTORY_LIMIT = 200;

// One flat lens over alert.event_type — the only type filter (a second
// fine-grained select over the same axis was redundant). Real engine
// vocabulary only: fires and resolves are instance transitions, deliveries
// are dispatcher sends, silenced rows are the dispatcher's muted-drop audit,
// rule health is the evaluator flagging a rule degraded/recovered.
const TYPE_LENSES = [
  { key: "all", label: "All", types: null },
  { key: "fired", label: "Fired", types: ["instance_fired"] },
  { key: "resolved", label: "Resolved", types: ["instance_resolved"] },
  { key: "deliveries", label: "Deliveries", types: ["delivery"] },
  { key: "silenced", label: "Silenced", types: ["silenced"] },
  { key: "rule_health", label: "Rule health", types: ["rule_health"] },
] as const;

type TypeLensKey = (typeof TYPE_LENSES)[number]["key"];

/**
 * What a feed row needs to know about its rule: resolved once by the caller
 * (History from the full rules list, the rule detail from its single rule).
 * `id` links the row to the rule page; `titleTemplate` renders the row's
 * notification summary.
 */
export type CcRuleFacts = {
  id: string;
  name: string;
  severity: string;
  titleTemplate: string | null;
};

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
  hideRuleColumns = false,
  resolveRule,
}: {
  /**
   * Scope the feed to one rule. Event rows carry the rule's slug when CC
   * knows it and the bare rule id otherwise, so callers that know both pass
   * both and either handle matches.
   */
  scopeSlug?: string | readonly string[];
  className?: string;
  /**
   * Drop the Severity and Rule columns and the severity filter. Every row in
   * a single-rule scoped feed shares the same rule, so those columns are
   * constant noise; callers scoping to one rule (e.g. the rule detail page)
   * pass this.
   */
  hideRuleColumns?: boolean;
  /**
   * Map a row's rule handle (slug or bare rule id) to its rule's facts. Rows
   * the resolver leaves unresolved render the raw handle and skip the
   * summary; severity falls back to the rule's only on fire/resolve
   * transitions (the only kinds a rule's severity describes).
   */
  resolveRule?: (handle: string) => CcRuleFacts | undefined;
}) {
  const [severity, setSeverity] = useState<string>("all");
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
        ? (resolveRule?.(e.slug)?.severity ?? null)
        : null),
    [resolveRule],
  );

  // Lens and severity compose with AND: each narrows independently of the
  // other ("all" is a no-op filter on that axis).
  const lensTypes = TYPE_LENSES.find((l) => l.key === typeLens)?.types ?? null;
  const filtered = useMemo(
    () =>
      scoped
        .filter(
          (e) =>
            lensTypes === null ||
            (lensTypes as readonly string[]).includes(e.eventType),
        )
        .filter((e) => severity === "all" || eventSeverity(e) === severity),
    [scoped, lensTypes, severity, eventSeverity],
  );

  const allColumns: Column<AlertEventLogRow>[] = [
    {
      header: "Time",
      cell: (e) => (
        <span className="whitespace-nowrap">{ccFormatTs(e.timestamp)}</span>
      ),
    },
    {
      header: "What happened",
      cell: (e) => {
        const status = ccEventStatus(e.eventType);
        return (
          <span className="inline-flex items-center gap-1.5">
            {status ? (
              <CcEventStatusBadge status={status} />
            ) : e.eventType === "delivery" ? (
              <span className="text-xs text-muted-foreground">
                delivered
                {e.deliveryTargets.length > 0 && (
                  <>
                    {" "}
                    <span aria-hidden>→ </span>
                    <span className="font-mono text-foreground">
                      {e.deliveryTargets.join(", ")}
                    </span>
                  </>
                )}
              </span>
            ) : e.eventType === "silenced" ? (
              <span className="text-xs text-muted-foreground">
                muted by silence
              </span>
            ) : e.eventType === "rule_health" ? (
              <span className="text-xs text-muted-foreground">
                evaluation health
              </span>
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
      header: "Instance",
      cell: (e) => {
        // A transition row summarizes itself in the rule's own notification
        // words; the raw evidence stays reachable in the summary's tooltip.
        // Rows without a template (or without a resolvable rule) keep the
        // evidence chips so nothing goes dark.
        const template =
          ccEventStatus(e.eventType) !== null
            ? resolveRule?.(e.slug)?.titleTemplate
            : null;
        const summary = template
          ? renderInstanceMessage(template, {
              labels: e.labels,
              evidence: e.evidence,
            })
          : null;
        return (
          <div className="flex flex-col gap-1">
            <LabelSet labels={e.labels} />
            {summary ? (
              <span
                className="max-w-96 truncate text-xs text-muted-foreground"
                title={
                  e.evidence
                    ? Object.entries(e.evidence)
                        .map(([k, v]) => `${k}=${String(v)}`)
                        .join("  ")
                    : undefined
                }
              >
                {summary}
              </span>
            ) : (
              <EvidenceChips
                evidence={e.evidence}
                truncated={e.evidenceTruncated}
              />
            )}
          </div>
        );
      },
    },
    {
      header: "Rule",
      cell: (e) => {
        const facts = resolveRule?.(e.slug);
        const name = facts?.name ?? e.slug;
        const title = name === e.slug ? e.slug : `${name} (${e.slug})`;
        return facts?.id ? (
          <Link
            to="/alerts/rules/$ruleId"
            params={{ ruleId: facts.id }}
            className="inline-block max-w-44 truncate align-bottom font-mono text-xs underline-offset-2 hover:underline"
            title={title}
          >
            {name}
          </Link>
        ) : (
          <span
            className="inline-block max-w-44 truncate align-bottom font-mono text-xs"
            title={title}
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
          Everything the alerting engine did in the selected time range, newest
          first: fires, resolves, notification deliveries, silence mutes.
        </CardDescription>
        {!hideRuleColumns && (
          <CardAction>
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
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
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
