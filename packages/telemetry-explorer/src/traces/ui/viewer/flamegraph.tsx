import { ScrollArea } from "@everr/ui/components/scroll-area";
import { formatDuration } from "@everr/ui/lib/formatting";
import { cn } from "@everr/ui/lib/utils";
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { TraceModel } from "./model";
import type { VisualLayout } from "./rendering/compute-visual-layout";
import type { EventRect, SpanRect } from "./rendering/types";
import { useFlamegraphDraw } from "./rendering/use-flamegraph-draw";

export type ViewRange = { start: number; end: number };
export type FlamegraphHandle = { scrollToSpan: (spanId: string) => void };

export function TimeRuler({
  range,
  className,
}: {
  range: ViewRange;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "text-muted-foreground flex h-7 shrink-0 justify-between border-b px-2 font-mono text-[10px]",
        className,
      )}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className="pt-1.5">
          {formatDuration(
            range.start + ((range.end - range.start) * i) / 4,
            "ms",
          )}
        </span>
      ))}
    </div>
  );
}

export function TraceFlamegraph({
  model,
  layout,
  selectedSpanId,
  matchingIds,
  filterActive,
  colorBy,
  range,
  onRangeChange,
  onSelect,
  ref,
}: {
  model: TraceModel;
  layout: VisualLayout;
  selectedSpanId?: string;
  matchingIds: ReadonlySet<string>;
  filterActive: boolean;
  colorBy: string;
  range: ViewRange;
  onRangeChange: (range: ViewRange) => void;
  onSelect: (id: string) => void;
  ref?: Ref<FlamegraphHandle>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const spanRectsRef = useRef<SpanRect[]>([]);
  const eventRectsRef = useRef<EventRect[]>([]);
  const dragRef = useRef<{
    x: number;
    range: ViewRange;
    moved: boolean;
  } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; width: number }>();
  const [scrollTop, setScrollTop] = useState(0);
  const [hover, setHover] = useState<{
    span: SpanRect;
    event?: EventRect;
    x: number;
    y: number;
  }>();
  const drawFlamegraph = useFlamegraphDraw({
    canvasRef,
    containerRef,
    spans: layout.visualRows,
    connectors: layout.connectors,
    viewStartTs: range.start,
    viewEndTs: range.end,
    scrollTop,
    rowHeight: 24,
    selectedSpanId,
    hoveredSpanId: hover?.span.span.spanId ?? "",
    spanRectsRef,
    eventRectsRef,
    matchingSpanIds: filterActive ? matchingIds : null,
    colorBy,
  });

  // URL selection controls the external scroll surface, not local selection state.
  useLayoutEffect(() => {
    const row = selectedSpanId
      ? layout.spanToVisualRow[selectedSpanId]
      : undefined;
    const container = containerRef.current;
    if (row !== undefined && container) {
      const top = row * 24;
      if (
        top < container.scrollTop ||
        top + 24 > container.scrollTop + container.clientHeight
      ) {
        container.scrollTop = Math.max(0, top - container.clientHeight / 2);
      }
    }
  }, [selectedSpanId, layout]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToSpan(id) {
        const row = layout.spanToVisualRow[id];
        const container = containerRef.current;
        if (row !== undefined && container)
          container.scrollTop = Math.max(
            0,
            row * 24 - container.clientHeight / 2,
          );
      },
    }),
    [layout],
  );

  // Synchronize an imperative drawing surface and its actual viewport size.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(container.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(container.clientHeight * dpr));
      canvas.style.width = `${container.clientWidth}px`;
      canvas.style.height = `${container.clientHeight}px`;
      drawFlamegraph();
    };
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    window.addEventListener("resize", draw);
    draw();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [drawFlamegraph]);

  const zoom = useCallback(
    (factor: number, anchor: number) => {
      const full = model.durationMs;
      const width = range.end - range.start;
      const nextWidth = Math.min(
        full,
        Math.max(Math.min(full, 0.001), width * factor),
      );
      const nextStart = Math.max(
        0,
        Math.min(
          full - nextWidth,
          range.start + width * anchor - nextWidth * anchor,
        ),
      );
      onRangeChange({ start: nextStart, end: nextStart + nextWidth });
    },
    [model.durationMs, range, onRangeChange],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoom(
        Math.exp(event.deltaY * 0.01),
        Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      );
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoom]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <TimeRuler range={range} />
      <ScrollArea
        viewportRef={containerRef}
        className="min-h-0 flex-1"
        viewportProps={{
          onScroll: (event) => setScrollTop(event.currentTarget.scrollTop),
        }}
      >
        <div
          style={{
            height: Math.max(160, layout.totalVisualRows * 24),
            minHeight: "100%",
          }}
        >
          <canvas
            ref={canvasRef}
            className="sticky top-0 block cursor-grab touch-none"
            role="img"
            aria-label="Trace flamegraph. Select spans using the waterfall, or click a flamegraph bar. Pinch to zoom and drag to pan."
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              setCursor(undefined);
              dragRef.current = { x: event.clientX, range, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const drag = dragRef.current;
              if (drag) {
                const delta = event.clientX - drag.x;
                if (Math.abs(delta) > 3) drag.moved = true;
                if (drag.moved) {
                  const width = drag.range.end - drag.range.start;
                  const start = Math.max(
                    0,
                    Math.min(
                      model.durationMs - width,
                      drag.range.start - (delta / rect.width) * width,
                    ),
                  );
                  onRangeChange({ start, end: start + width });
                  setHover(undefined);
                }
                return;
              }
              const x = event.clientX - rect.left;
              const y = event.clientY - rect.top;
              setCursor({
                x: Math.max(0, Math.min(rect.width, x)),
                width: rect.width,
              });
              const span = [...spanRectsRef.current]
                .reverse()
                .find(
                  (s) =>
                    x >= s.x &&
                    x <= s.x + s.width &&
                    y >= s.y &&
                    y <= s.y + s.height,
                );
              const dot = eventRectsRef.current.find(
                (e) =>
                  Math.abs(e.cx - x) <= e.halfSize + 2 &&
                  Math.abs(e.cy - y) <= e.halfSize + 2,
              );
              setHover(
                span
                  ? {
                      span,
                      event: dot,
                      x: Math.min(x + 12, rect.width - 260),
                      y,
                    }
                  : undefined,
              );
            }}
            onPointerUp={(event) => {
              const moved = dragRef.current?.moved;
              dragRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
              if (moved) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const x = event.clientX - rect.left;
              const y = event.clientY - rect.top;
              const hit = [...spanRectsRef.current]
                .reverse()
                .find(
                  (s) =>
                    x >= s.x &&
                    x <= s.x + s.width &&
                    y >= s.y &&
                    y <= s.y + s.height,
                );
              if (hit) onSelect(hit.span.spanId);
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
            onPointerLeave={() => {
              setHover(undefined);
              setCursor(undefined);
            }}
            onDoubleClick={() =>
              onRangeChange({ start: 0, end: model.durationMs })
            }
          />
        </div>
      </ScrollArea>
      {cursor && cursor.width > 0 && (
        <div
          aria-hidden
          data-slot="flamegraph-crosshair"
          className="pointer-events-none absolute inset-y-0 z-10 border-l border-foreground/35"
          style={{ left: cursor.x }}
        >
          <span
            className="absolute top-0 whitespace-nowrap rounded border bg-popover px-1.5 py-1 font-mono text-[10px] text-popover-foreground shadow-sm"
            style={{
              transform: `translateX(${cursor.x < 60 ? "0" : cursor.x > cursor.width - 60 ? "-100%" : "-50%"})`,
            }}
          >
            {formatDuration(
              range.start +
                (cursor.x / cursor.width) * (range.end - range.start),
              "ms",
            )}
          </span>
        </div>
      )}
      {hover && (
        <div
          className="pointer-events-none absolute z-20 max-w-64 rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-md"
          style={{
            left: Math.max(8, hover.x),
            top: Math.min(
              hover.y + 35,
              (containerRef.current?.clientHeight ?? 160) - 65,
            ),
          }}
        >
          <div className="truncate font-medium">
            {hover.event?.event.name ?? hover.span.span.name}
          </div>
          <div className="text-muted-foreground mt-1 truncate">
            {hover.span.span.resource["service.name"]}
          </div>
          <div className="mt-1 font-mono">
            {formatDuration(hover.span.span.durationNano, "ns")}
            {hover.span.span.hasError ? " · Error" : ""}
          </div>
        </div>
      )}
    </div>
  );
}
