import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import { cn } from "@everr/ui/lib/utils";
import { memo, useMemo } from "react";
import { formatElapsed } from "@/data/alerting/triage/format";
import type {
  ChartWindow,
  InstanceValueSeries,
  RuleStateSegment,
} from "@/data/alerting/triage/view";
import { STATUS_META, StatusIcon } from "./alert-status";
import {
  ChartCrosshair,
  instanceRowsAt,
  tooltipTime,
  useChartScrub,
} from "./chart-crosshair";

/** The states this chart paints, in legend order. The words, fills and legend
 *  tones all come from `STATUS_META`, so the chart, the band headers and the
 *  icon column can never call the same state two different things. */
const SEGMENT_STATES: RuleStateSegment["state"][] = [
  "firing",
  "pending",
  "silenced",
  "degraded",
];

/** "3d 4h ago", or the bare "just now", which takes no suffix. The same
 *  elapsed formatter the rest of the feature prints with, so the description
 *  and the tooltip cannot call one stretch two different lengths. */
function startedAgo(minutes: number) {
  const elapsed = formatElapsed(minutes * 60_000);
  return elapsed === "just now" ? elapsed : `${elapsed} ago`;
}

/**
 * One rule's state over the selected window, as a chart rather than a
 * one-colour bar: each stretch is painted in the colour of the state the rule
 * was actually in, so a pending run that never reached firing looks different
 * from one that did, and flapping reads as a comb.
 *
 * Empty track is `inactive`, the ground state.
 */
export const RuleStateChart = memo(function RuleStateChart({
  segments,
  instances,
  window: { minutes: windowMinutes, endsAt: windowTo },
  name,
}: {
  segments: RuleStateSegment[];
  /** The values behind the states, for the tooltip. */
  instances: InstanceValueSeries[];
  /** The window the segments and values are measured against: the server's,
   *  which read them, not one resolved here. */
  window: ChartWindow;
  /** For the accessible description; the visible label is the row's own. */
  name: string;
}) {
  // Both of these are rebuilt from the data, not from the pointer, and this
  // component sets state on every mousemove: without the memo a scrub across
  // one row re-projects every segment and re-joins the whole label.
  const visible = useMemo(
    () =>
      segments
        .filter((s) => s.to < windowMinutes && s.from > s.to)
        .map((s) => {
          const from = Math.min(s.from, windowMinutes);
          return {
            ...s,
            left: ((windowMinutes - from) / windowMinutes) * 100,
            // A one-evaluation blip would otherwise be sub-pixel and invisible.
            width: Math.max(0.6, ((from - s.to) / windowMinutes) * 100),
            minutes: from - s.to,
          };
        }),
    [segments, windowMinutes],
  );

  const label = useMemo(
    () =>
      visible.length === 0
        ? `${name}: inactive for the whole window`
        : `${name}: ${visible
            .map(
              (s) =>
                `${STATUS_META[s.state].label.toLowerCase()} for ${formatElapsed(s.minutes * 60_000)} starting ${startedAgo(s.from)}`,
            )
            .join(", ")}`,
    [visible, name],
  );

  // The instant under the pointer, in minutes before the end of the window.
  const scrub = useChartScrub(windowMinutes);
  const { hovered } = scrub;
  const segment =
    hovered == null
      ? null
      : (visible.find((s) => hovered.at <= s.from && hovered.at >= s.to) ??
        null);

  return (
    <div
      className="relative h-3.5 overflow-hidden rounded-sm bg-muted/40"
      role="img"
      onMouseMove={scrub.onMouseMove}
      onMouseLeave={scrub.onMouseLeave}
      aria-label={label}
    >
      {visible.map((s, i) => (
        <span
          key={`${s.state}-${s.from}-${s.to}-${i}`}
          className={cn(
            "absolute inset-y-0 rounded-[2px]",
            STATUS_META[s.state].fill,
          )}
          style={{ left: `${s.left}%`, width: `${s.width}%` }}
        />
      ))}
      {hovered && (
        <>
          <ChartCrosshair left={scrub.left} />
          <CursorTooltip x={hovered.clientX} y={hovered.clientY}>
            <SeriesTooltipContent
              title={
                <span className="flex items-baseline gap-2">
                  <span>{tooltipTime(windowTo, hovered.at)}</span>
                  <span className="text-foreground">
                    {segment
                      ? `${STATUS_META[segment.state].label} ${formatElapsed(segment.minutes * 60_000)}`
                      : "Inactive"}
                  </span>
                </span>
              }
              rows={instanceRowsAt(instances, hovered.at, windowMinutes)}
            />
          </CursorTooltip>
        </>
      )}
    </div>
  );
});

/**
 * Axis ticks take their unit from the window, not from their own value: a
 * scale that reads "3.5d | 42h" makes the reader convert mid-glance. One
 * unit per axis, chosen by how far back the whole thing reaches.
 */
function axisTick(minutes: number, windowMinutes: number) {
  if (minutes <= 0) return "now";
  const round = (n: number) => (n % 1 ? n.toFixed(1) : String(n));
  if (windowMinutes < 90) return `${Math.round(minutes)}m`;
  if (windowMinutes < 48 * 60) return `${round(Math.round(minutes / 6) / 10)}h`;
  return `${round(Math.round(minutes / 144) / 10)}d`;
}

/** Five evenly spaced ticks, oldest at the left edge, `now` at the right. */
export function StateChartAxis({ windowMinutes }: { windowMinutes: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div aria-hidden className="relative h-3">
      {ticks.map((t) => (
        <span
          key={t}
          className={cn(
            "absolute top-0 font-mono text-[0.625rem] text-muted-foreground tabular-nums",
            t === 0 && "left-0",
            t === 1 && "right-0",
          )}
          style={
            t === 0 || t === 1
              ? undefined
              : { left: `${t * 100}%`, transform: "translateX(-50%)" }
          }
        >
          {axisTick(windowMinutes * (1 - t), windowMinutes)}
        </span>
      ))}
    </div>
  );
}

type LegendState = RuleStateSegment["state"] | "inactive";

const LEGEND_STATES: LegendState[] = [
  ...SEGMENT_STATES,
  // The ground state has no segment: empty track is what it looks like.
  "inactive",
];

/**
 * States get named once, above the charts, instead of in every row.
 *
 * The entries are the status icons, not colour swatches: the same glyph marks
 * every rule in the list below, so one key now reads both the icon column and
 * the chart, where a swatch only ever read the chart.
 */
export function StateChartLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {LEGEND_STATES.map((state) => (
        <li
          key={state}
          className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground"
        >
          <StatusIcon status={state} className={STATUS_META[state].chartText} />
          {STATUS_META[state].label}
        </li>
      ))}
    </ul>
  );
}
