import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { ScrollArea } from "@everr/ui/components/scroll-area";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import { cn } from "@everr/ui/lib/utils";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import {
  TimeTrackAxis,
  TimeTrackOverlay,
  TRACK_LABEL_WIDTH,
  useTimeTrack,
  leftForSibling,
} from "./time-track";
import type { ResolvedTimeRange } from "./index";

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
  empty,
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
  /** Shown instead of the chart when no lane has an item in the domain. */
  empty: ReactNode;
  onTimeRangeChange: (range: ResolvedTimeRange) => void;
}) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const track = useTimeTrack(domain, onTimeRangeChange);

  const span = domain[1] - domain[0];

  const toPct = useCallback((ts: number) => ((ts - domain[0]) / span) * 100, [domain, span]);

  // The blocks follow the data, not the pointer: hovering only moves the
  // tooltip, so the blocks are built once per result.
  const rows = useMemo(
    () => (
      <div className="flex h-full min-h-fit flex-col gap-1 py-1">
        {lanes.map((lane) => (
          <div key={lane.label} className="flex min-h-5 flex-1 items-stretch">
            <div
              className="shrink-0 self-center truncate pr-2 text-xs text-muted-foreground"
              style={{ width: TRACK_LABEL_WIDTH }}
              title={lane.label}
            >
              {lane.label}
            </div>
            <div className="relative min-w-0 flex-1 overflow-hidden">
              {lane.items.map((item) => (
                <div
                  key={item.key}
                  data-slot="lane-item"
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
                  onMouseLeave={(e) => {
                    if (!leftForSibling(e)) setHover(null);
                  }}
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
    ),
    [lanes, colorByState, rowHeight, showValues, rounded, toPct],
  );

  if (span <= 0 || !lanes.some((l) => l.items.length > 0)) {
    return empty;
  }

  return (
    <div className="flex h-full select-none flex-col overflow-hidden">
      {/* chart area — pointer interactions and the brush overlay cover the
          lanes + axis but not the legend */}
      <div
        className="relative flex min-h-0 flex-1 flex-col"
        {...track.handlers}
        onMouseMove={(e) => {
          track.handlers.onMouseMove(e);
          setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h));
        }}
        onMouseLeave={() => {
          track.handlers.onMouseLeave();
          setHover(null);
        }}
      >
        {/* No overscroll-none here: lanes usually fit, and a non-scrollable
            scroll container with overscroll-behavior:none swallows wheel
            events instead of letting the page scroll. */}
        <ScrollArea className="min-h-0 flex-1">{rows}</ScrollArea>

        <TimeTrackAxis domain={domain} trackRef={track.trackRef} />
        <TimeTrackOverlay domain={domain} brush={track.brush} />
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
