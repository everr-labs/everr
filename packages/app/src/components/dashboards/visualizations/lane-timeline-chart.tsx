import { cn } from "@everr/ui/lib/utils";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { CursorTooltip } from "@/components/cursor-tooltip";
import { createTimeTickFormatter, generateTimeTicks, SERIES_COLORS } from "./data-utils";
import type { ResolvedTimeRange } from "./index";
import { SeriesTooltipContent } from "./series-tooltip";

const BRUSH_COLOR = SERIES_COLORS[0];
const MAX_X_TICKS = 6;
/** Lane label gutter width — the axis row and brush overlay offset by the same
 * amount so they stay aligned with the segment tracks. */
const LABEL_WIDTH = 96;

export interface LaneTimelineItem {
  /** Stable React key, unique within the lane. */
  key: string | number;
  /** Item bounds in ms, already clamped to the domain. */
  start: number;
  end: number;
  state: string;
  /** Tooltip title — a time range (StateTimeline) or a single instant (StatusHistory). */
  title: string;
}

export interface LaneTimelineLane {
  label: string;
  items: LaneTimelineItem[];
}

interface HoverState {
  lane: string;
  item: LaneTimelineItem;
  x: number;
  y: number;
}

/**
 * Shared renderer for lane-of-colored-blocks timelines (StateTimeline,
 * StatusHistory). Owns the time axis, drag-to-zoom brush, legend and tooltip;
 * the caller supplies pre-positioned items per lane and the color map, so the
 * two charts differ only in how they build items (hold-until-next segments vs
 * fixed-width cells) and a couple of cosmetic props.
 */
export function LaneTimelineChart({
  lanes,
  states,
  colorByState,
  domain,
  rowHeight,
  showValues,
  showLegend,
  rounded = false,
  emptyIcon,
  emptyMessage,
  onTimeRangeChange,
}: {
  lanes: LaneTimelineLane[];
  states: string[];
  colorByState: Record<string, string>;
  domain: [number, number];
  rowHeight: number;
  showValues: boolean;
  showLegend: boolean;
  /** Round item corners (StatusHistory cells). */
  rounded?: boolean;
  emptyIcon: ReactNode;
  emptyMessage: string;
  onTimeRangeChange: (range: ResolvedTimeRange) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const trackRectRef = useRef<DOMRect | null>(null);
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [brushEnd, setBrushEnd] = useState<number | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const span = domain[1] - domain[0];
  const ticks = useMemo(() => generateTimeTicks(domain, MAX_X_TICKS), [domain]);
  const formatTick = useMemo(() => createTimeTickFormatter(domain), [domain]);

  const toPct = useCallback((ts: number) => ((ts - domain[0]) / span) * 100, [domain, span]);

  const pxToTimestamp = useCallback(
    (clientX: number, rect: DOMRect) => {
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return domain[0] + ratio * span;
    },
    [domain, span],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      trackRectRef.current = rect;
      setBrushStart(pxToTimestamp(e.clientX, rect));
      setBrushEnd(null);
      if (e.target instanceof HTMLElement) {
        e.target.setPointerCapture(e.pointerId);
      }
    },
    [pxToTimestamp],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (brushStart == null || !trackRectRef.current) return;
      setBrushEnd(pxToTimestamp(e.clientX, trackRectRef.current));
    },
    [brushStart, pxToTimestamp],
  );

  const handlePointerUp = useCallback(() => {
    if (brushStart != null && brushEnd != null) {
      const from = Math.min(brushStart, brushEnd);
      const to = Math.max(brushStart, brushEnd);
      if (to - from > 1000) {
        onTimeRangeChange({ from: new Date(from), to: new Date(to) });
      }
    }
    setBrushStart(null);
    setBrushEnd(null);
    trackRectRef.current = null;
  }, [brushStart, brushEnd, onTimeRangeChange]);

  if (span <= 0 || !lanes.some((l) => l.items.length > 0)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        {emptyIcon}
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full select-none flex-col overflow-hidden">
      {/* chart area — pointer interactions and the brush overlay cover the
          lanes + axis but not the legend */}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onMouseMove={(e) => setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))}
        onMouseLeave={() => setHover(null)}
      >
        {/* No overscroll-none here: lanes usually fit, and a non-scrollable
            scroll container with overscroll-behavior:none swallows wheel
            events instead of letting the page scroll. */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="flex h-full min-h-fit flex-col gap-1 py-1">
            {lanes.map((lane) => (
              <div key={lane.label} className="flex min-h-5 flex-1 items-stretch">
                <div
                  className="shrink-0 self-center truncate pr-2 text-xs text-muted-foreground"
                  style={{ width: LABEL_WIDTH }}
                  title={lane.label}
                >
                  {lane.label}
                </div>
                <div className="relative min-w-0 flex-1 overflow-hidden">
                  {lane.items.map((item) => (
                    <div
                      key={item.key}
                      className={cn(
                        "absolute flex items-center justify-center overflow-hidden px-1",
                        rounded && "rounded-[2px]",
                      )}
                      style={{
                        left: `${toPct(item.start)}%`,
                        width: `${toPct(item.end) - toPct(item.start)}%`,
                        minWidth: 2,
                        top: `${((1 - rowHeight) / 2) * 100}%`,
                        height: `${rowHeight * 100}%`,
                        backgroundColor: colorByState[item.state],
                      }}
                      onMouseEnter={(e) =>
                        setHover({
                          lane: lane.label,
                          item,
                          x: e.clientX,
                          y: e.clientY,
                        })
                      }
                      onMouseLeave={() => setHover(null)}
                    >
                      {showValues && (
                        <span className="truncate text-[10px] font-medium text-white">
                          {item.state}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* time axis, aligned with the item tracks */}
        <div className="flex h-5 shrink-0 items-start overflow-hidden">
          <div className="shrink-0" style={{ width: LABEL_WIDTH }} />
          <div ref={trackRef} className="relative min-w-0 flex-1">
            {ticks.map((tick) => (
              <span
                key={tick}
                className="-translate-x-1/2 absolute top-1 text-[10px] text-muted-foreground tabular-nums"
                style={{ left: `${toPct(tick)}%` }}
              >
                {formatTick(tick)}
              </span>
            ))}
          </div>
        </div>

        {brushStart != null && brushEnd != null && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 overflow-hidden"
            style={{ left: LABEL_WIDTH }}
          >
            <div
              className="absolute inset-y-0 border-x"
              style={{
                left: `${toPct(Math.min(brushStart, brushEnd))}%`,
                width: `${Math.abs(toPct(brushEnd) - toPct(brushStart))}%`,
                backgroundColor: BRUSH_COLOR,
                opacity: 0.15,
                borderColor: BRUSH_COLOR,
              }}
            />
          </div>
        )}
      </div>

      {showLegend && states.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-1.5">
          {states.map((state) => (
            <div key={state} className="flex items-center gap-1.5 text-xs">
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: colorByState[state] }}
              />
              <span className="text-muted-foreground">{state}</span>
            </div>
          ))}
        </div>
      )}

      {hover && (
        <CursorTooltip x={hover.x} y={hover.y}>
          <SeriesTooltipContent
            title={hover.item.title}
            rows={[
              {
                key: hover.lane,
                color: colorByState[hover.item.state],
                label: hover.lane,
                value: hover.item.state,
              },
            ]}
          />
        </CursorTooltip>
      )}
    </div>
  );
}
