/* oxlint-disable jsx-a11y/prefer-tag-over-role -- This composite control or canvas chart needs its ARIA role and cannot be represented by a native input, select, or img. */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@everr/ui/components/context-menu";
import { ScrollArea } from "@everr/ui/components/scroll-area";
import { formatDuration } from "@everr/ui/lib/formatting";
import { cn } from "@everr/ui/lib/utils";
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { SpanName } from "../span-name";
import type { TraceModel } from "./model";
import type { VisualLayout } from "./rendering/compute-visual-layout";
import { formatSpanDuration } from "./rendering/draw-utils";
import type { EventRect, FlamegraphSpan, SpanRect } from "./rendering/types";
import { useFlamegraphDraw } from "./rendering/use-flamegraph-draw";

export type ViewRange = { start: number; end: number };
export type FlamegraphHandle = { scrollToSpan: (spanId: string) => void };

export function TimeRuler({ range, className }: { range: ViewRange; className?: string }) {
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
          {formatDuration(range.start + ((range.end - range.start) * i) / 4, "ms")}
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
  colors,
  range,
  onRangeChange,
  onSelect,
  formatValue = formatSpanDuration,
  colorOf,
  timeAxis = true,
  renderHover,
  onHoverChange,
  renderContextMenu,
  ariaLabel = "Trace flamegraph. Select spans using the waterfall, or click a flamegraph bar. Pinch to zoom and drag to pan.",
  ref,
}: {
  // Only the full extent is read, so a profile can pass its total weight.
  model: Pick<TraceModel, "durationMs">;
  layout: VisualLayout;
  selectedSpanId?: string;
  matchingIds: ReadonlySet<string>;
  filterActive: boolean;
  colorBy: string;
  colors: ReadonlyMap<string, string>;
  range: ViewRange;
  onRangeChange: (range: ViewRange) => void;
  onSelect: (id: string) => void;
  formatValue?: (durationNano: number) => string;
  colorOf?: (span: FlamegraphSpan) => string | undefined;
  // Off when the x axis is not time, as in a profile, where it is sample weight.
  timeAxis?: boolean;
  renderHover?: (span: FlamegraphSpan) => ReactNode;
  /** Called with the hovered bar's id when it changes, and `undefined` when the pointer leaves the bars. */
  onHoverChange?: (id: string | undefined) => void;
  /** Menu items for a right-clicked bar. Without it the browser's menu shows. */
  renderContextMenu?: (id: string) => ReactNode;
  ariaLabel?: string;
  ref?: Ref<FlamegraphHandle>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const spanRectsRef = useRef<SpanRect[]>([]);
  const eventRectsRef = useRef<EventRect[]>([]);
  const directSelectionRef = useRef<string | undefined>(undefined);
  const lastSelectedSpanIdRef = useRef(selectedSpanId);
  const dragRef = useRef<{
    x: number;
    range: ViewRange;
    moved: boolean;
  } | null>(null);
  // The x of each pointer on the bars, and the two-finger zoom they started.
  const pointersRef = useRef(new Map<number, number>());
  const pinchRef = useRef<{ distance: number; mid: number; range: ViewRange } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; width: number }>();
  const [hover, setHover] = useState<{
    span: SpanRect;
    event?: EventRect;
    x: number;
    y: number;
    // Shown by a tap, since touch has no hover, until the next touch or scroll.
    tapped?: boolean;
  }>();
  // The bar a right-click or long-press landed on, kept while its menu is open.
  const [menuId, setMenuId] = useState<string>();
  const menuTargetRef = useRef<string | undefined>(undefined);
  // A long-press opens the menu before the finger lifts; lifting must not also select.
  const menuOpenedRef = useRef(false);
  const hoveredId = hover?.span.span.spanId;
  const changeHover = (next: typeof hover) => {
    setHover(next);
    const id = next?.span.span.spanId;
    if (id !== hoveredId) onHoverChange?.(id);
  };
  const barAt = (event: { clientX: number; clientY: number; currentTarget: Element }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const rects = spanRectsRef.current;
    // The last drawn bar is on top.
    for (let i = rects.length - 1; i >= 0; i--) {
      const s = rects[i];
      if (x >= s.x && x <= s.x + s.width && y >= s.y && y <= s.y + s.height) return s;
    }
    return undefined;
  };
  const hoverAt = (event: { clientX: number; clientY: number; currentTarget: Element }) => {
    const span = barAt(event);
    if (!span) return undefined;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dot = eventRectsRef.current.find(
      (e) => Math.abs(e.cx - x) <= e.halfSize + 2 && Math.abs(e.cy - y) <= e.halfSize + 2,
    );
    return { span, event: dot, x: Math.min(x + 12, rect.width - 260), y };
  };
  const drawFlamegraph = useFlamegraphDraw({
    canvasRef,
    containerRef,
    spans: layout.visualRows,
    connectors: layout.connectors,
    viewStartTs: range.start,
    viewEndTs: range.end,
    rowHeight: 24,
    selectedSpanId,
    hoveredSpanId: hover?.span.span.spanId ?? "",
    spanRectsRef,
    eventRectsRef,
    matchingSpanIds: filterActive ? matchingIds : null,
    colorBy,
    colors,
    formatValue,
    colorOf,
  });

  // URL selection controls the external scroll surface, not local selection state.
  useLayoutEffect(() => {
    const selectionChanged = selectedSpanId !== lastSelectedSpanIdRef.current;
    lastSelectedSpanIdRef.current = selectedSpanId;
    if (selectionChanged) {
      const isDirectSelection = selectedSpanId && selectedSpanId === directSelectionRef.current;
      directSelectionRef.current = undefined;
      if (isDirectSelection) return;
    }
    const row = selectedSpanId ? layout.spanToVisualRow[selectedSpanId] : undefined;
    const container = containerRef.current;
    if (row !== undefined && container) {
      const top = row * 24;
      if (top < container.scrollTop || top + 24 > container.scrollTop + container.clientHeight) {
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
          container.scrollTop = Math.max(0, row * 24 - container.clientHeight / 2);
      },
    }),
    [layout],
  );

  // Synchronize an imperative drawing surface and its actual viewport size.
  useLayoutEffect(() => {
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
      const nextWidth = Math.min(full, Math.max(Math.min(full, 0.001), width * factor));
      const nextStart = Math.max(
        0,
        Math.min(full - nextWidth, range.start + width * anchor - nextWidth * anchor),
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
      {timeAxis ? <TimeRuler range={range} /> : null}
      <ScrollArea
        viewportRef={containerRef}
        className="min-h-0 flex-1"
        viewportProps={{
          onScroll: () => {
            if (hover?.tapped) changeHover(undefined);
            drawFlamegraph();
          },
        }}
      >
        <BarsSurface
          height={Math.max(160, layout.totalVisualRows * 24)}
          menu={renderContextMenu && menuId ? renderContextMenu(menuId) : undefined}
          menuEnabled={renderContextMenu !== undefined}
          onMenuOpenChange={(open) => {
            if (open) menuOpenedRef.current = true;
            // Only a right-click or long-press on a bar opens the menu; the empty area keeps none.
            setMenuId(open ? menuTargetRef.current : undefined);
          }}
        >
          <canvas
            ref={canvasRef}
            // Vertical swipes scroll the bars natively; horizontal drags and
            // pinches reach the handlers below.
            className="sticky top-0 block cursor-grab touch-pan-y"
            role="img"
            aria-label={ariaLabel}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              setCursor(undefined);
              if (event.pointerType === "touch") changeHover(undefined);
              // iOS fires no contextmenu event for a long-press, so the bar under
              // the finger is the menu's target until a right-click says otherwise.
              menuTargetRef.current = barAt(event)?.span.spanId;
              menuOpenedRef.current = false;
              const pointers = pointersRef.current;
              pointers.set(event.pointerId, event.clientX);
              if (pointers.size === 2) {
                const [a = 0, b = 0] = pointers.values();
                const rect = event.currentTarget.getBoundingClientRect();
                pinchRef.current = {
                  distance: Math.max(1, Math.abs(a - b)),
                  mid: (a + b) / 2 - rect.left,
                  range,
                };
                dragRef.current = null;
              } else if (pointers.size === 1) {
                dragRef.current = { x: event.clientX, range, moved: false };
              }
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const pointers = pointersRef.current;
              if (pointers.has(event.pointerId)) pointers.set(event.pointerId, event.clientX);
              const pinch = pinchRef.current;
              if (pinch) {
                if (pointers.size < 2) return;
                const [a = 0, b = 0] = pointers.values();
                const full = model.durationMs;
                const width = pinch.range.end - pinch.range.start;
                const nextWidth = Math.min(
                  full,
                  Math.max(
                    Math.min(full, 0.001),
                    (width * pinch.distance) / Math.max(1, Math.abs(a - b)),
                  ),
                );
                // The value under the fingers' midpoint stays under it as they move.
                const anchor = pinch.range.start + (width * pinch.mid) / rect.width;
                const mid = (a + b) / 2 - rect.left;
                const start = Math.max(
                  0,
                  Math.min(full - nextWidth, anchor - (nextWidth * mid) / rect.width),
                );
                onRangeChange({ start, end: start + nextWidth });
                return;
              }
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
                  changeHover(undefined);
                }
                return;
              }
              if (event.pointerType === "touch") return;
              setCursor({
                x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
                width: rect.width,
              });
              changeHover(hoverAt(event));
            }}
            onPointerUp={(event) => {
              pointersRef.current.delete(event.pointerId);
              event.currentTarget.releasePointerCapture(event.pointerId);
              // A pinch ends when its last finger lifts, without selecting.
              if (pinchRef.current) {
                if (pointersRef.current.size === 0) pinchRef.current = null;
                return;
              }
              const moved = dragRef.current?.moved;
              dragRef.current = null;
              if (moved || menuOpenedRef.current) return;
              const hit = hoverAt(event);
              if (hit) {
                directSelectionRef.current =
                  hit.span.span.spanId === selectedSpanId ? undefined : hit.span.span.spanId;
                onSelect(hit.span.span.spanId);
                if (event.pointerType === "touch") changeHover({ ...hit, tapped: true });
              }
            }}
            onPointerCancel={(event) => {
              // The browser took over, to scroll or for a long-press.
              pointersRef.current.delete(event.pointerId);
              if (pointersRef.current.size === 0) pinchRef.current = null;
              dragRef.current = null;
            }}
            onPointerLeave={(event) => {
              // A lifted finger leaves too; a tapped bar's details stay up.
              if (event.pointerType === "touch") return;
              changeHover(undefined);
              setCursor(undefined);
            }}
            onContextMenu={(event) => {
              menuTargetRef.current = barAt(event)?.span.spanId;
              changeHover(undefined);
            }}
            onDoubleClick={() => onRangeChange({ start: 0, end: model.durationMs })}
          />
        </BarsSurface>
      </ScrollArea>
      {timeAxis && cursor && cursor.width > 0 && (
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
              range.start + (cursor.x / cursor.width) * (range.end - range.start),
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
            top: Math.min(hover.y + 35, (containerRef.current?.clientHeight ?? 160) - 65),
          }}
        >
          {renderHover ? (
            renderHover(hover.span.span)
          ) : (
            <>
              <div className="truncate font-medium">
                {hover.event ? hover.event.event.name : <SpanName name={hover.span.span.name} />}
              </div>
              <div className="text-muted-foreground mt-1 truncate">
                {hover.span.span.resource["service.name"]}
              </div>
              <div className="mt-1 font-mono">
                {formatDuration(hover.span.span.durationNano, "ns")}
                {hover.span.span.hasError ? " · Error" : ""}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The scrollable bars, with a right-click menu when the host gives one. */
function BarsSurface({
  height,
  menu,
  menuEnabled,
  onMenuOpenChange,
  children,
}: {
  height: number;
  menu: ReactNode;
  menuEnabled: boolean;
  onMenuOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const style = { height, minHeight: "100%" };
  if (!menuEnabled) return <div style={style}>{children}</div>;
  return (
    <ContextMenu open={menu !== undefined} onOpenChange={onMenuOpenChange}>
      <ContextMenuTrigger render={<div style={style} />}>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">{menu}</ContextMenuContent>
    </ContextMenu>
  );
}
