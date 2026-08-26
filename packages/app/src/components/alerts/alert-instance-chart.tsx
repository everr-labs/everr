import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import { useMemo } from "react";
import type {
  ChartWindow,
  InstanceValuePoint,
  InstanceValueSeries,
} from "@/data/alerting/triage/view";
import {
  BREACHING,
  ChartCrosshair,
  instanceRowsAt,
  pointNear,
  printValue,
  QUIET,
  tooltipTime,
  useChartScrub,
} from "./chart-crosshair";
import { StateChartAxis } from "./rule-state-chart";

/** The plot's own coordinate space, stretched to the lane by the viewBox. */
const PLOT_W = 1000;
const PLOT_H = 100;

/** A line needs height to have a shape, and the panel is a column: this is
 *  the most a lane can take and still leave room for ten of them. */
const LANE_HEIGHT = "2.25rem";

/** Wide enough for a short label set, narrow enough that the chart keeps the
 *  width. Longer labels truncate and keep their full text in `title`. Spelled
 *  out rather than composed from the two lengths: Tailwind reads class names
 *  out of the source text, so an interpolated one compiles to nothing and the
 *  lanes silently lose the grid. */
const LANE_GRID =
  "grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_5rem] items-center gap-x-3";
/** Must track the grid above: the crosshair is positioned against the plot
 *  column, which starts where the label column and its gap end, and stops
 *  where the value column and its gap begin. */
const PLOT_INSET = "calc(9rem + 0.75rem)";
const VALUE_INSET = "calc(5rem + 0.75rem)";

type Domain = { min: number; max: number };

/**
 * One lane, one value axis.
 *
 * A shared axis sounds right and reads wrong: one instance spiking to 1200
 * while the rest sit near 500 spends the whole scale on the spike and flattens
 * every other lane into a straight line at the floor. These are sparklines,
 * and the shape over time is what they are for, so each lane gets the range
 * its own readings need. The magnitude the shared axis used to carry is
 * printed beside the lane instead, where it can be read rather than estimated.
 */
function laneDomain(points: InstanceValuePoint[]): Domain {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    min = Math.min(min, point.value);
    max = Math.max(max, point.value);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (max === min) return { min: min - 1, max: max + 1 };
  // Headroom at both ends, so the extremes are not drawn on the lane's edge.
  const pad = (max - min) * 0.12;
  return { min: min - pad, max: max + pad };
}

function describe(points: InstanceValuePoint[]) {
  const last = points[points.length - 1];
  let low = Infinity;
  let high = -Infinity;
  for (const point of points) {
    low = Math.min(low, point.value);
    high = Math.max(high, point.value);
  }
  const breaching = points.filter((point) => point.breaching).length;
  return `${points.length} evaluated buckets, ${breaching} breaching, last ${printValue(last.value)}, between ${printValue(low)} and ${printValue(high)}`;
}

function Lane({
  lane,
  minutes,
  bucketMinutes,
  intervalMinutes,
  threshold,
  showScale,
  hoveredAt,
  onScrub,
}: {
  lane: InstanceValueSeries;
  minutes: number;
  bucketMinutes: number;
  /** How far apart two readings sit when the rule is healthy. */
  intervalMinutes: number;
  threshold: number;
  /** Every lane is read against the same threshold; only the top one that
   *  can show the guide prints its number. */
  showScale: boolean;
  hoveredAt: number | null;
  /** Ratio across the lane, 0 at the oldest edge, with the pointer position
   *  the tooltip follows. */
  onScrub: (ratio: number, clientX: number, clientY: number) => void;
}) {
  const visible = useMemo(
    () => lane.points.filter((point) => point.at <= minutes),
    [lane.points, minutes],
  );

  // Each lane's own range, so its shape fills the lane it was given.
  const domain = useMemo(() => laneDomain(visible), [visible]);

  const y = (value: number) =>
    PLOT_H - ((value - domain.min) / (domain.max - domain.min)) * PLOT_H;
  const x = (at: number) => ((minutes - at) / minutes) * PLOT_W;
  // How wide the hover marker is: one bucket, so it covers the reading it
  // names and nothing either side of it.
  const width = Math.max(1.2, (bucketMinutes / minutes) * PLOT_W * 0.86);

  // Oldest first, so the path is drawn left to right.
  const ordered = useMemo(
    () => [...visible].sort((a, b) => b.at - a.at),
    [visible],
  );
  // A line bridges whatever it is drawn across, so a stretch the rule never
  // evaluated would read as a slow drift between two distant readings.
  //
  // Readings the rule actually produced are joined: the line interpolates
  // between them, which is what a reading every interval is supposed to look
  // like. A hole wider than one healthy step is not interpolated, it is cut,
  // so a rule that stopped evaluating for five minutes shows five minutes of
  // nothing. The step is the evaluation interval, or the bucket when the
  // window is long enough that several evaluations share one.
  const gapMinutes = Math.max(bucketMinutes, intervalMinutes) * 1.5;
  const segments = useMemo(() => {
    const out: InstanceValuePoint[][] = [];
    let run: InstanceValuePoint[] = [];
    for (const point of ordered) {
      const previous = run[run.length - 1];
      if (previous && previous.at - point.at > gapMinutes) {
        out.push(run);
        run = [];
      }
      run.push(point);
    }
    if (run.length > 0) out.push(run);
    return out;
  }, [ordered, gapMinutes]);

  const label = useMemo(
    () => `${lane.labels}: ${describe(visible)}`,
    [lane.labels, visible],
  );

  const guide =
    threshold > domain.min && threshold < domain.max ? y(threshold) : null;
  // Only the reading the pointer is actually over: a lane that stopped
  // evaluating gets no mark for an instant inside its gap, so the mark and the
  // tooltip row appear and disappear together.
  const marker =
    hoveredAt == null ? null : pointNear(visible, hoveredAt, bucketMinutes / 2);

  if (visible.length === 0) {
    return (
      <div
        className="flex items-center rounded-sm bg-muted/25 px-2 text-xs text-muted-foreground/70"
        style={{ height: LANE_HEIGHT }}
      >
        not evaluated in this window
      </div>
    );
  }

  return (
    <div
      className="relative rounded-sm bg-muted/25"
      style={{ height: LANE_HEIGHT }}
    >
      <svg
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          onScrub(
            (event.clientX - box.left) / box.width,
            event.clientX,
            event.clientY,
          );
        }}
        role="img"
        aria-label={label}
      >
        <title>{lane.labels}</title>
        {segments.map((segment) => {
          const key = segment[0].at;
          // A lone reading between two gaps has no line to be drawn as: a
          // dot keeps it on the lane instead of dropping it.
          if (segment.length === 1) {
            const point = segment[0];
            return (
              <circle
                key={key}
                cx={x(point.at)}
                cy={y(point.value)}
                r={1.5}
                fill={point.breaching ? BREACHING : QUIET}
                opacity={0.9}
              />
            );
          }
          const path = segment
            .map(
              (point, index) =>
                `${index === 0 ? "M" : "L"}${x(point.at).toFixed(2)} ${y(point.value).toFixed(2)}`,
            )
            .join(" ");
          // The engine's own Condition verdict, carried by the line itself
          // rather than by a mark drawn over it: every link that touches a
          // breaching bucket is redrawn in the breaching colour, so the value
          // and the decision behind it are the same stroke.
          const breachingLinks: string[] = [];
          for (let i = 1; i < segment.length; i++) {
            const from = segment[i - 1];
            const to = segment[i];
            if (!from.breaching && !to.breaching) continue;
            breachingLinks.push(
              `M${x(from.at).toFixed(2)} ${y(from.value).toFixed(2)} L${x(to.at).toFixed(2)} ${y(to.value).toFixed(2)}`,
            );
          }
          return (
            <g key={key}>
              <path
                d={path}
                fill="none"
                stroke={QUIET}
                strokeWidth={1.25}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
              {breachingLinks.length > 0 && (
                <path
                  d={breachingLinks.join(" ")}
                  fill="none"
                  stroke={BREACHING}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          );
        })}
        {guide != null && (
          <line
            x1={0}
            x2={PLOT_W}
            y1={guide}
            y2={guide}
            stroke={QUIET}
            strokeWidth={1}
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
            opacity={0.65}
          />
        )}
        {marker && (
          <rect
            x={x(marker.at) - width / 2}
            y={0}
            width={width}
            height={PLOT_H}
            fill="var(--foreground)"
            opacity={0.12}
          />
        )}
      </svg>
      {showScale && guide != null && (
        // Centred on the guide, unless the guide sits so high that a centred
        // label would climb out of the lane and land on the axis above it.
        <span
          className={`pointer-events-none absolute right-0 bg-background/90 px-0.5 font-mono text-[0.625rem] text-muted-foreground tabular-nums ${
            guide > PLOT_H * 0.2 ? "-translate-y-1/2" : ""
          }`}
          style={{ top: `${(guide / PLOT_H) * 100}%` }}
        >
          {printValue(threshold)}
        </span>
      )}
    </div>
  );
}

/**
 * The lane's last reading, in the number the line only draws.
 *
 * With every lane on its own scale, two lines of the same shape can be two
 * orders of magnitude apart. This is the column that says which.
 */
function LaneValue({
  lane,
  minutes,
}: {
  lane: InstanceValueSeries;
  minutes: number;
}) {
  const last = useMemo(() => {
    let newest: InstanceValuePoint | null = null;
    for (const point of lane.points) {
      if (point.at > minutes) continue;
      if (!newest || point.at < newest.at) newest = point;
    }
    return newest;
  }, [lane.points, minutes]);

  if (!last) {
    return (
      <span className="text-right font-mono text-xs text-muted-foreground/60">
        n/a
      </span>
    );
  }
  return (
    <span
      className={`truncate text-right font-mono text-xs tabular-nums ${
        last.breaching ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {printValue(last.value)}
    </span>
  );
}

/**
 * What every Alert instance measured over the window, one sparkline each.
 *
 * A line rather than a bar per bucket: ten stacked lanes of bars read as
 * texture, and the shape of the value over time is what a responder compares
 * across instances. The line breaks wherever the rule stopped evaluating, so
 * a gap still reads as a gap, and the breaching buckets are marked on top, so
 * the number and the engine's own verdict on it arrive together.
 */
export function AlertInstanceChart({
  lanes,
  hidden,
  threshold,
  window: { minutes, endsAt: windowTo },
  bucketMinutes,
  intervalMinutes,
}: {
  lanes: InstanceValueSeries[];
  hidden: number;
  threshold: number;
  /** The window the lanes were read over, from the same response. */
  window: ChartWindow;
  bucketMinutes: number;
  intervalMinutes: number;
}) {
  // One instant across every lane: the comparison the stacked lanes exist for
  // is "what were the others doing when this one crossed".
  const scrub = useChartScrub(minutes);
  const { hovered } = scrub;

  // Only the instances that measured something under the pointer. Half a
  // bucket either side of the pointer is the bucket it is on: an instance that
  // has no reading there is left out of the card rather than represented by
  // whichever of its readings happens to be closest, which would print a
  // number from another instant as if it were this one's.
  const rows = useMemo(
    () =>
      hovered
        ? instanceRowsAt(lanes, hovered.at, minutes, bucketMinutes / 2)
        : [],
    [lanes, hovered, minutes, bucketMinutes],
  );

  return (
    <div className="flex flex-col gap-2 px-3">
      <figure
        className={`relative m-0 ${LANE_GRID}`}
        aria-label="Evaluated values per Alert instance"
        onMouseLeave={scrub.onMouseLeave}
      >
        <span />
        <div className="pb-1">
          <StateChartAxis windowMinutes={minutes} />
        </div>
        <span className="pb-1 text-right font-mono text-[0.625rem] text-muted-foreground">
          last
        </span>

        {lanes.map((lane, index) => (
          <div key={lane.fingerprint} className="contents">
            <span
              title={lane.labels}
              className="truncate font-mono text-xs text-muted-foreground"
            >
              {lane.labels}
            </span>
            <div className="py-0.5">
              <Lane
                onScrub={scrub.scrubTo}
                lane={lane}
                minutes={minutes}
                bucketMinutes={bucketMinutes}
                intervalMinutes={intervalMinutes}
                threshold={threshold}
                showScale={index === 0}
                hoveredAt={hovered?.at ?? null}
              />
            </div>
            <LaneValue lane={lane} minutes={minutes} />
          </div>
        ))}

        {hovered && (
          <div
            className="pointer-events-none absolute inset-y-0"
            style={{ left: PLOT_INSET, right: VALUE_INSET }}
          >
            <ChartCrosshair left={scrub.left} />
          </div>
        )}
      </figure>

      {hovered && rows.length > 0 && (
        <CursorTooltip x={hovered.clientX} y={hovered.clientY}>
          <SeriesTooltipContent
            title={tooltipTime(windowTo, hovered.at)}
            rows={rows}
          />
        </CursorTooltip>
      )}
      {hidden > 0 && (
        <p className="text-right font-mono text-xs text-muted-foreground">
          +{hidden} more instances
        </p>
      )}
    </div>
  );
}
