import { ChartGantt } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { CursorTooltip } from "@/components/cursor-tooltip";
import {
  createTimeTickFormatter,
  generateTimeTicks,
  SERIES_COLORS,
} from "../data-utils";
import type { VisualizationProps } from "../index";
import { SeriesTooltipContent } from "../series-tooltip";
import type { StateTimelineSpec } from "./spec";
import {
  buildStateTimelineModel,
  type StateSegment,
} from "./state-timeline-data";

const BRUSH_COLOR = SERIES_COLORS[0]!;
const MAX_X_TICKS = 6;
/** Lane label gutter width — the axis row and brush overlay offset by the same
 * amount so they stay aligned with the segment tracks. */
const LABEL_WIDTH = 96;

interface HoverState {
  lane: string;
  segment: StateSegment;
  x: number;
  y: number;
}

export function StateTimelineVisualization({
  spec,
  data,
  timeRange,
  onTimeRangeChange,
}: VisualizationProps<StateTimelineSpec>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const trackRectRef = useRef<DOMRect | null>(null);
  const [brushStart, setBrushStart] = useState<number | null>(null);
  const [brushEnd, setBrushEnd] = useState<number | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const domain = useMemo<[number, number]>(
    () => [timeRange.from.getTime(), timeRange.to.getTime()],
    [timeRange],
  );
  const span = domain[1] - domain[0];

  const model = useMemo(
    () => (data ? buildStateTimelineModel(data, spec, domain) : null),
    [data, spec, domain],
  );

  const ticks = useMemo(() => generateTimeTicks(domain, MAX_X_TICKS), [domain]);
  const formatTick = useMemo(() => createTimeTickFormatter(domain), [domain]);

  const toPct = useCallback(
    (ts: number) => ((ts - domain[0]) / span) * 100,
    [domain, span],
  );

  const pxToTimestamp = useCallback(
    (clientX: number, rect: DOMRect) => {
      const ratio = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width),
      );
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
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
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

  if (!model || span <= 0 || !model.lanes.some((l) => l.segments.length > 0)) {
    const message = !data
      ? "Configure a query to see results"
      : "No state data in this time range";
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <ChartGantt className="size-8" />
        <p className="text-sm">{message}</p>
      </div>
    );
  }

  const { lanes, states, colorByState } = model;

  return (
    <div className="flex h-full select-none flex-col overflow-hidden">
      {/* chart area — pointer interactions and the brush overlay cover the
          lanes + axis but not the legend */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: chart interaction area */}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onMouseMove={(e) =>
          setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h))
        }
        onMouseLeave={() => setHover(null)}
      >
        {/* No overscroll-none here: lanes usually fit, and a non-scrollable
            scroll container with overscroll-behavior:none swallows wheel
            events instead of letting the page scroll. */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="flex h-full min-h-fit flex-col gap-1 py-1">
            {lanes.map((lane) => (
              <div
                key={lane.label}
                className="flex min-h-5 flex-1 items-stretch"
              >
                <div
                  className="shrink-0 self-center truncate pr-2 text-xs text-muted-foreground"
                  style={{ width: LABEL_WIDTH }}
                  title={lane.label}
                >
                  {lane.label}
                </div>
                <div className="relative min-w-0 flex-1 overflow-hidden">
                  {lane.segments.map((segment) => (
                    // biome-ignore lint/a11y/noStaticElementInteractions: hover target for the tooltip
                    <div
                      key={segment.start}
                      className="absolute flex items-center justify-center overflow-hidden px-1"
                      style={{
                        left: `${toPct(segment.start)}%`,
                        width: `${toPct(segment.end) - toPct(segment.start)}%`,
                        minWidth: 2,
                        top: `${((1 - spec.rowHeight) / 2) * 100}%`,
                        height: `${spec.rowHeight * 100}%`,
                        backgroundColor: colorByState[segment.state],
                      }}
                      onMouseEnter={(e) =>
                        setHover({
                          lane: lane.label,
                          segment,
                          x: e.clientX,
                          y: e.clientY,
                        })
                      }
                      onMouseLeave={() => setHover(null)}
                    >
                      {spec.showValues && (
                        <span className="truncate text-[10px] font-medium text-white">
                          {segment.state}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* time axis, aligned with the segment tracks */}
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

      {spec.showLegend && states.length > 0 && (
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
            title={`${new Date(hover.segment.start).toLocaleString()} – ${new Date(hover.segment.end).toLocaleString()}`}
            rows={[
              {
                key: hover.lane,
                color: colorByState[hover.segment.state],
                label: hover.lane,
                value: hover.segment.state,
              },
            ]}
          />
        </CursorTooltip>
      )}
    </div>
  );
}
