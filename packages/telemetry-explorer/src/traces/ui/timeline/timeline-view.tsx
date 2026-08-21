import { ScrollAreaScroller } from "@everr/ui/components/scroll-area";
import { useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import type { Span } from "../../data/types";
import { SpanDetailPanel } from "./span-detail-panel";
import { SpanRow } from "./span-row";
import { useTimelineLayout } from "./use-timeline-layout";

// Kept at module level: virtuoso remounts the scroller, and so loses the
// scroll position, whenever the component identity changes.
const components = { Scroller: ScrollAreaScroller };

type Props = {
  spans: Span[];
  focusedSpan: string | undefined;
  onSelectSpan: (spanId: string | undefined) => void;
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
        components={components}
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
          onClose={() => onSelectSpan(undefined)}
        />
      )}
    </div>
  );
}
