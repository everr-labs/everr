import { useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import type { Span } from "@/data/traces/types";
import { SpanDetailPanel } from "./span-detail-panel";
import { SpanRow } from "./span-row";
import { useTimelineLayout } from "./use-timeline-layout";

type Props = {
  spans: Span[];
  focusedSpan: string | undefined;
  onSelectSpan: (spanId: string) => void;
};

export function TimelineView({ spans, focusedSpan, onSelectSpan }: Props) {
  const { rows, traceStartNs, traceEndNs, toggleCollapse } =
    useTimelineLayout(spans);

  const selected = useMemo(
    () =>
      focusedSpan ? spans.find((s) => s.spanId === focusedSpan) : undefined,
    [spans, focusedSpan],
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <Virtuoso
        className="flex-1"
        data={rows}
        computeItemKey={(_, row) => row.span.spanId}
        itemContent={(_, row) => (
          <SpanRow
            row={row}
            traceStartNs={traceStartNs}
            traceEndNs={traceEndNs}
            selected={row.span.spanId === focusedSpan}
            onToggle={() => toggleCollapse(row.span.spanId)}
            onSelect={() => onSelectSpan(row.span.spanId)}
          />
        )}
      />
      {selected && (
        <SpanDetailPanel
          span={selected}
          traceStartNs={traceStartNs}
          onClose={() => onSelectSpan("")}
        />
      )}
    </div>
  );
}
