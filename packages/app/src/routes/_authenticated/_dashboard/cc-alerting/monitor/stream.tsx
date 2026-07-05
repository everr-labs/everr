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
import { createFileRoute } from "@tanstack/react-router";
import { Pause, Play, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { CcEvent } from "@/data/cc/types";
import { useCcEvents } from "@/hooks/use-cc-events";
import {
  CcConnectionBadge,
  CcEmptyState,
  CcEventStatusBadge,
  CcSeverityBadge,
  ccFormatTs,
  LabelSet,
} from "../-cc-shared";

const SEVERITY_LABELS: Record<string, string> = {
  all: "All severities",
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/monitor/stream",
)({
  component: CcMonitorStream,
});

function CcMonitorStream() {
  const { events, connected, clear, setPaused } = useCcEvents();
  const [paused, setLocalPaused] = useState(false);
  const [severity, setSeverity] = useState<string>("all");

  const filtered = useMemo(
    () =>
      severity === "all"
        ? events
        : events.filter((e) => e.severity === severity),
    [events, severity],
  );

  const columns: Column<CcEvent>[] = [
    { header: "Time", cell: (e) => ccFormatTs(e.eval_ts) },
    { header: "Status", cell: (e) => <CcEventStatusBadge status={e.status} /> },
    {
      header: "Severity",
      cell: (e) => <CcSeverityBadge severity={e.severity} />,
    },
    { header: "Kind", cell: (e) => e.kind ?? "alert" },
    { header: "Labels", cell: (e) => <LabelSet labels={e.labels} /> },
    {
      header: "Rule",
      cell: (e) => (
        <span className="font-mono text-xs">{e.rule.slice(0, 8)}</span>
      ),
    },
  ];

  return (
    <Card inset="flush-content">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Live tail
          <CcConnectionBadge connected={connected} />
        </CardTitle>
        <CardDescription>
          Last 500 events. CC events are streamed, not stored — a queryable
          history arrives once CC writes events to ClickHouse.
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
              Clear
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <DataTable
          data={filtered}
          columns={columns}
          rowKey={(e, i) => `${e.instance_key}-${e.eval_ts}-${i}`}
          emptyState={
            <CcEmptyState
              icon={paused ? Pause : undefined}
              title={
                paused
                  ? "Stream paused"
                  : severity === "all"
                    ? "Waiting for events…"
                    : `No ${severity} events yet`
              }
              hint={
                paused
                  ? "Resume to keep tailing live events."
                  : "Events appear here in real time as rules evaluate."
              }
            />
          }
        />
      </CardContent>
    </Card>
  );
}
