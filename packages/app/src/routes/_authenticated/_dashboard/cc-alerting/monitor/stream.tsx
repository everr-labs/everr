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
import { type TimeRange, withTimeRange } from "@everr/ui/lib/time-range";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
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
  LabelSet,
} from "../-cc-shared";

const SEVERITY_LABELS: Record<string, string> = {
  all: "All severities",
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

const HISTORY_LIMIT = 200;

const historyQuery = (timeRange: TimeRange) =>
  queryOptions({
    queryKey: ["cc", "event-history", timeRange],
    queryFn: () =>
      listCcEventHistory({ data: { limit: HISTORY_LIMIT, timeRange } }),
  });

export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/monitor/stream",
)({
  // The cc-alerting section hides the global time-range picker; this page reads
  // stored history, so it opts back in (the deepest staticData value wins).
  staticData: { hideTimeRangePicker: false },
  loaderDeps: ({ search }) => ({ timeRange: withTimeRange(search).timeRange }),
  loader: ({ context: { queryClient }, deps }) =>
    queryClient.prefetchQuery(historyQuery(deps.timeRange)),
  component: CcMonitorStream,
});

function CcMonitorStream() {
  const { events, connected, clear, setPaused } = useCcEvents();
  const [paused, setLocalPaused] = useState(false);
  const [severity, setSeverity] = useState<string>("all");
  const { timeRange } = useTimeRange();
  const history = useQuery(historyQuery(timeRange));

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

  const filtered = useMemo(
    () =>
      severity === "all"
        ? merged
        : merged.filter((e) => e.severity === severity),
    [merged, severity],
  );

  const columns: Column<CcUnifiedEvent>[] = [
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
      cell: (e) =>
        e.severity ? (
          <CcSeverityBadge severity={e.severity} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    { header: "Labels", cell: (e) => <LabelSet labels={e.labels} /> },
    {
      header: "Rule",
      cell: (e) => (
        <span
          className="inline-block max-w-44 truncate align-bottom font-mono text-xs"
          title={e.rule}
        >
          {e.rule}
        </span>
      ),
    },
  ];

  return (
    <Card inset="flush-content">
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
              value={severity}
              onValueChange={(v) => setSeverity(v ?? "all")}
            >
              <SelectTrigger size="sm" className="w-36">
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
