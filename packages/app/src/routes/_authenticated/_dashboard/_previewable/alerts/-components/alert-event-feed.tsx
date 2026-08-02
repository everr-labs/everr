// packages/app/src/routes/_authenticated/_dashboard/_previewable/alerts/-components/alert-event-feed.tsx
// Stored CC event history from ClickHouse, polled to stay current, always
// scoped to one alert source (`scopeSlug`). The rule detail page is its only
// mount: the unscoped variant went with the History page, and with it the
// severity/rule columns and the coarse type lens, which only ever earned their
// place on a feed mixing many sources.
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
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ALERT_EVENT_TYPES,
  type AlertEventType,
  ccEventStatus,
} from "@/data/alerts/event-types";
import type { AlertEventLogRow } from "@/data/alerts/history.server";
import { ccQueries } from "@/data/cc/queries";
import { useTimeRange } from "@/hooks/use-time-range";
import {
  CcEmptyState,
  CcEventStatusBadge,
  CcTableSkeleton,
  ccErrorMessage,
  ccFormatTs,
  EvidenceChips,
  LabelSet,
} from "./shared";

// Display labels for the engine's event-type vocabulary (ALERT_EVENT_TYPES);
// the Record keying keeps this exhaustive against it.
const EVENT_TYPE_LABELS: Record<AlertEventType, string> = {
  instance_fired: "Fired",
  instance_resolved: "Resolved",
  delivery: "Delivery",
  rule_health: "Rule health",
  silenced: "Silenced",
};

export function AlertEventFeed({
  scopeSlug,
  preview,
}: {
  /**
   * Scope the feed to one rule. Event rows carry the rule's slug when CC
   * knows it and the bare rule id otherwise, so callers that know both pass
   * both and either handle matches.
   */
  scopeSlug: readonly string[];
  /**
   * The selected preview, when the surrounding page has one. Preview-rule
   * records are suppressed but carry the same service.name as live ones, so
   * the feed reads live-only unless a preview asks for them back.
   */
  preview?: string;
}) {
  const [eventType, setEventType] = useState<string>("all");
  const { timeRange } = useTimeRange();
  // A scoped feed narrows to its handles server-side, so the row cap applies
  // after scoping: without it, other sources on a busy tenant fill the
  // newest-N window and starve this source of its older events.
  const history = useQuery(
    ccQueries.eventHistory(timeRange, {
      slugs: scopeSlug,
      ...(preview ? { preview } : {}),
    }),
  );

  const rows = history.data ?? [];

  const filtered = useMemo(() => {
    const handles = new Set(scopeSlug);
    return rows
      .filter((e) => handles.has(e.slug))
      .filter((e) => eventType === "all" || e.eventType === eventType);
  }, [rows, scopeSlug, eventType]);

  // Every row shares this feed's rule, so the rule and its severity are
  // constants: the columns that named them belonged to the cross-source feed.
  const columns: Column<AlertEventLogRow>[] = [
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
  ];

  return (
    <Card inset="flush-content">
      <CardHeader>
        <CardTitle>Event history</CardTitle>
        <CardDescription>
          Alert events read from ClickHouse for the selected time range, newest
          first.
        </CardDescription>
        <CardAction>
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
        </CardAction>
      </CardHeader>
      <CardContent>
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
                  eventType === "all"
                    ? "No events in range"
                    : `No ${EVENT_TYPE_LABELS[eventType as AlertEventType]} events`
                }
                hint="Events appear here as this rule fires, resolves, and delivers."
              />
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
