// One line per SLI group: the engine fires per group, so a pooled line would
// let a high-volume healthy group hide one that is past its own line.
import { ChartContainer, ChartTooltip } from "@everr/ui/components/chart";
import {
  ChartEmptyState,
  formatChartDate,
} from "@everr/ui/components/chart-helpers";
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { CursorTooltip } from "@/components/cursor-tooltip";
import {
  hoverMarkers,
  markerTolerance,
  nearestSeriesKeys,
  valueAtCursorY,
} from "@/components/dashboards/visualizations/chart-hover";
import { SERIES_COLORS } from "@/components/dashboards/visualizations/data-utils";
import {
  SeriesTooltipContent,
  type SeriesTooltipRow,
} from "@/components/dashboards/visualizations/series-tooltip";
import type { CcSloBudgetGroupSeries } from "@/data/cc/slo-series.server";
import { ccFmtBudgetRemaining } from "./budget-bar";

// Overspend is unbounded (a budget can read -99900%), so plotting it literally
// would crush the axis; a group past its line rests on the floor and the
// tooltip reports how far past.
const FLOOR_PCT = 0;
const CEIL_PCT = 100;

// Plot geometry declared, not measured: recharts hands `chartY` to the mouse
// handler but not the plot rect, and mapping cursor height to a budget needs
// both, so the plot box is fixed here and fed to the chart.
const CHART_H = 240;
const MARGIN_TOP = 8;
const XAXIS_H = 30;
const PLOT = { top: MARGIN_TOP, height: CHART_H - MARGIN_TOP - XAXIS_H };

const Y_DOMAIN: [number, number] = [FLOOR_PCT, CEIL_PCT];
const HOVER_TIE_PCT = markerTolerance(PLOT.height, CEIL_PCT - FLOOR_PCT);

const EMPTY_KEYS: ReadonlySet<string> = new Set();

/** Row key holding a series' pre-epoch (reconstructed) stretch. */
const reconKey = (dataKey: string) => `${dataKey}_recon`;

// Capped at the palette's distinct colours; the worst groups win the slots and
// the caller is told how many were left off.
const MAX_SERIES = SERIES_COLORS.length;

export type SloBudgetEvent = {
  /** Instant of the transition, ISO 8601. */
  t: string;
  /** `firing` = a burn tier fired; `resolved` = it cleared. */
  type: "firing" | "resolved";
  /** Which burn tier, from the instance's `slo_tier` label. Absent if unlabelled. */
  tier?: string;
};

const EVENT_COLOR = {
  firing: "var(--color-red-500)",
  resolved: "var(--color-green-500)",
} as const;
const APPLIED_COLOR = "var(--color-blue-500)";
// Fraction of the plot past which the "applied" label flips to the rule's left.
// Declared, not measured, like the plot box; flipping early is harmless.
const APPLIED_LABEL_FLIP_AT = 0.8;

// A 1px dashed rule is far too thin to hover, so each marker instant also gets
// an invisible wide line as the hit target. `transparent` is a paint value, so
// the stroke still hit-tests under the default `visiblePainted`.
const MARKER_HIT_WIDTH = 14;

const fmtCount = (n: number) => n.toLocaleString();

function seriesLabel(labels: Record<string, string>): string {
  const values = Object.values(labels);
  return values.length === 0 ? "Budget remaining" : values.join(", ");
}

/** Latest measured budget, for ranking; null sorts as healthiest. */
function currentBudget(group: CcSloBudgetGroupSeries): number {
  for (let i = group.points.length - 1; i >= 0; i--) {
    const b = group.points[i].budgetRemaining;
    if (b !== null) return b;
  }
  return Number.POSITIVE_INFINITY;
}

/** One spec drives both the plotted mark and its key swatch, so they cannot diverge. */
type Stroke = {
  width: number;
  /** Dash and gap in px; omit for a solid stroke. */
  dash?: [on: number, off: number];
  opacity?: number;
};

const EVENT_STROKE: Stroke = { width: 1, dash: [2, 2], opacity: 0.6 };

/** The plot varies series weight by rank; the key does not. */
const SERIES_STROKE: Stroke = { width: 2 };

const dashArray = (s: Stroke) => s.dash?.join(" ");

type KeyItem = { label: string; color: string; stroke: Stroke };

const SWATCH_LEN = { horizontal: 16, vertical: 12 };

function KeyEntry({ item, vertical }: { item: KeyItem; vertical?: boolean }) {
  const { stroke } = item;
  // A `dashed` border this short collapses to a solid bar; a repeating
  // gradient dashes predictably at any size.
  const axis = vertical ? "to bottom" : "to right";
  const [on, off] = stroke.dash ?? [];
  const len = vertical ? SWATCH_LEN.vertical : SWATCH_LEN.horizontal;
  return (
    <li className="flex items-center gap-1.5">
      <span
        aria-hidden
        // Swatch matches the mark's orientation: series horizontal, transition
        // rules vertical.
        className="shrink-0"
        style={{
          width: vertical ? stroke.width : len,
          height: vertical ? len : stroke.width,
          opacity: stroke.opacity,
          ...(on === undefined
            ? { backgroundColor: item.color }
            : {
                backgroundImage: `repeating-linear-gradient(${axis}, ${item.color} 0 ${on}px, transparent ${on}px ${on + (off ?? 0)}px)`,
              }),
        }}
      />
      {item.label}
    </li>
  );
}

function ChartKey({ series, marks }: { series: KeyItem[]; marks: KeyItem[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[0.6875rem] text-muted-foreground">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.map((it) => (
          <KeyEntry key={it.label} item={it} />
        ))}
      </ul>
      {marks.length > 0 && (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {marks.map((it) => (
            <KeyEntry key={it.label} item={it} vertical />
          ))}
        </ul>
      )}
    </div>
  );
}

type MarkerTip = { t: string; rows: SeriesTooltipRow[] };

export function SloBudgetChart({
  groups,
  epoch,
  events,
}: {
  /** One series per SLI group, all on the same instant grid. */
  groups: CcSloBudgetGroupSeries[];
  /**
   * When the budget's meaning begins (apply / last significant edit, ISO
   * 8601); everything before it is reconstructed. Omit to treat the whole
   * range as observed.
   */
  epoch?: string;
  /** Transitions overlaid as vertical markers, each snapped to the nearest plotted instant. */
  events?: SloBudgetEvent[];
}) {
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    index: number;
    /** The cursor's height read as a budget %, or null if unmeasurable. */
    pct: number | null;
  } | null>(null);
  // A hovered vertical marker takes precedence over the point readout.
  const [markerHover, setMarkerHover] = useState<{
    x: number;
    y: number;
    tip: MarkerTip;
  } | null>(null);

  const instants = groups[0]?.points ?? [];
  if (instants.length === 0) {
    return (
      <ChartEmptyState message="No telemetry in this range to compute the budget" />
    );
  }

  // Worst first: slot 0 gets the emphasis and survives the MAX_SERIES cut.
  const ranked = [...groups].sort(
    (a, b) => currentBudget(a) - currentBudget(b),
  );
  const shown = ranked.slice(0, MAX_SERIES);
  const hiddenCount = ranked.length - shown.length;

  const series = shown.map((group, i) => ({
    ...group,
    // `s0`, `s1`, ... — recharts needs a flat, stable key per line.
    dataKey: `s${i}`,
    label: seriesLabel(group.labels),
    color: SERIES_COLORS[i % SERIES_COLORS.length],
  }));

  const epochMs = epoch ? Date.parse(epoch) : Number.NaN;
  const hasEpoch = Number.isFinite(epochMs);
  // First instant on/after the epoch; -1 means the whole range predates it.
  const boundary = hasEpoch
    ? instants.findIndex((p) => Date.parse(p.t) >= epochMs)
    : 0;
  // The "applied" marker only draws when the boundary falls inside the range:
  // boundary 0 is off the left edge, -1 is off the right.
  const markerT = boundary > 0 ? instants[boundary].t : null;
  // The label reads rightwards from its rule, so a late marker spills past the
  // chart; anchor it on the rule's other side instead.
  const appliedLabelPosition =
    boundary / (instants.length - 1) > APPLIED_LABEL_FLIP_AT
      ? "insideTopRight"
      : "insideTopLeft";
  const reconstructedTo =
    boundary === -1 ? instants[instants.length - 1].t : markerT;
  const isReconstructed = (i: number) =>
    boundary === -1 || (boundary > 0 && i < boundary);

  // Rows carry floored values; true (unfloored) values are read from `shown`
  // by index when the tooltip needs them. Each series splits at the epoch into
  // two keys: a `<Line>` carries one stroke style, so dashed-to-solid must be
  // two lines sharing the boundary point; `plottedPct` rejoins them for reads.
  const data = instants.map((_, pointIdx) => {
    const row: Record<string, string | number | null> = {
      t: instants[pointIdx].t,
    };
    for (const s of series) {
      const raw = s.points[pointIdx].budgetRemaining;
      const pct =
        raw === null
          ? null
          : Math.min(CEIL_PCT, Math.max(raw * 100, FLOOR_PCT));
      const reconstructed = isReconstructed(pointIdx);
      row[s.dataKey] = reconstructed ? null : pct;
      // The boundary point belongs to both keys so the segments meet, but only
      // when a reconstructed stretch exists: with nothing before the epoch, a
      // lone shared point would draw a stray dot.
      row[reconKey(s.dataKey)] =
        reconstructed || (boundary > 0 && pointIdx === boundary) ? pct : null;
    }
    return row;
  });

  /** A series' value at an instant, whichever side of the epoch it fell on. */
  const plottedPct = (pointIdx: number, dataKey: string) => {
    const row = data[pointIdx];
    const v = row?.[dataKey] ?? row?.[reconKey(dataKey)];
    return typeof v === "number" ? v : null;
  };

  // The X axis is categorical, so a marker can only land on an existing tick:
  // snap to the nearest plotted point, or null outside the range.
  const pointMs = instants.map((p) => Date.parse(p.t));
  const snapToPoint = (ms: number): string | null => {
    if (
      !Number.isFinite(ms) ||
      ms < pointMs[0] ||
      ms > pointMs[pointMs.length - 1]
    )
      return null;
    let idx = 0;
    let best = Math.abs(pointMs[0] - ms);
    for (let i = 1; i < pointMs.length; i++) {
      const d = Math.abs(pointMs[i] - ms);
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    return instants[idx].t;
  };

  // Deduped by (instant, type) so several same-type transitions on one tick
  // draw one bar; the tiers behind each bar feed the marker's tooltip.
  const eventMarks: {
    key: string;
    t: string;
    type: "firing" | "resolved";
    tiers: string[];
  }[] = [];
  if (events?.length) {
    const byKey = new Map<string, (typeof eventMarks)[number]>();
    for (const ev of events) {
      const t = snapToPoint(Date.parse(ev.t));
      if (t === null) continue;
      const key = `${t}|${ev.type}`;
      let mark = byKey.get(key);
      if (!mark) {
        mark = { key, t, type: ev.type, tiers: [] };
        byKey.set(key, mark);
        eventMarks.push(mark);
      }
      if (ev.tier && !mark.tiers.includes(ev.tier)) mark.tiers.push(ev.tier);
    }
  }

  // One hit target per instant, not per bar: a fire and a resolve can snap to
  // the same tick, and overlapping hit lines would fight for the pointer.
  const markerHits = new Map<string, MarkerTip>();
  for (const m of eventMarks) {
    const tip = markerHits.get(m.t) ?? { t: m.t, rows: [] };
    for (const tier of m.tiers.length > 0 ? m.tiers : [null]) {
      tip.rows.push({
        key: `${m.type}|${tier ?? ""}`,
        color: EVENT_COLOR[m.type],
        label: tier ?? "alert",
        value: m.type === "firing" ? "fired" : "resolved",
      });
    }
    markerHits.set(m.t, tip);
  }
  if (markerT) {
    const tip = markerHits.get(markerT) ?? { t: markerT, rows: [] };
    tip.rows.push({
      key: "applied",
      color: APPLIED_COLOR,
      label: "applied",
      value: "budget starts counting",
    });
    markerHits.set(markerT, tip);
  }

  const keySeries = series.map((s) => ({
    label: s.label,
    color: s.color,
    stroke: SERIES_STROKE,
  }));
  const keyMarks = [
    ...(eventMarks.some((m) => m.type === "firing")
      ? [
          {
            label: "Alert fired",
            color: EVENT_COLOR.firing,
            stroke: EVENT_STROKE,
          },
        ]
      : []),
    ...(eventMarks.some((m) => m.type === "resolved")
      ? [
          {
            label: "Alert resolved",
            color: EVENT_COLOR.resolved,
            stroke: EVENT_STROKE,
          },
        ]
      : []),
  ];

  const nearestKeys =
    hover === null
      ? EMPTY_KEYS
      : nearestSeriesKeys(
          series.map((s) => ({
            key: s.dataKey,
            value: plottedPct(hover.index, s.dataKey),
          })),
          hover.pct,
          HOVER_TIE_PCT,
        );
  const pointHover = markerHover === null ? hover : null;

  const hoveredIsReconstructed =
    hover !== null &&
    boundary !== 0 &&
    (boundary === -1 || hover.index < boundary);

  return (
    <>
      <ChartContainer
        // Empty: the config's `--color-<key>` vars need a fixed series set,
        // and these series are discovered at runtime, so each Line carries its
        // own colour.
        config={{}}
        className="w-full"
        style={{ height: CHART_H }}
      >
        <LineChart
          data={data}
          margin={{ left: 12, right: 12, top: 8 }}
          // recharts does the hit-testing (activeTooltipIndex); the native
          // event carries the viewport coords the portaled card needs.
          onMouseMove={(state, e) => {
            const i = state?.activeTooltipIndex;
            if (
              !(state?.isTooltipActive && typeof i === "number" && i >= 0 && e)
            ) {
              setHover(null);
              return;
            }
            const pct = valueAtCursorY(state.chartY, PLOT, Y_DOMAIN);
            setHover({ x: e.clientX, y: e.clientY, index: i, pct });
          }}
          onMouseLeave={() => setHover(null)}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="t"
            height={XAXIS_H}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={40}
            interval="preserveStartEnd"
            tickFormatter={formatChartDate}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={44}
            // Axis bounds equal the quantity's own bounds, so the floor is a
            // real limit rather than a chosen viewport.
            domain={Y_DOMAIN}
            tickFormatter={(v: number) => `${v}%`}
          />
          {/* Pre-epoch region shaded once for the whole plot rather than
            dashed per line: stays readable at any group count. */}
          {reconstructedTo && (
            <ReferenceArea
              x1={instants[0].t}
              x2={reconstructedTo}
              fill="var(--muted-foreground)"
              // Below ~0.1 the wash vanishes on the dark card.
              fillOpacity={0.16}
              strokeOpacity={0}
              label={{
                value: "reconstructed",
                position: "insideTopLeft",
                fontSize: 10,
                fill: "var(--muted-foreground)",
              }}
            />
          )}
          {/* Drives recharts' active index only; the visible card is the
            portaled CursorTooltip below. */}
          <ChartTooltip cursor={false} content={() => null} />
          {/* Painted worst-last so the worst group sits on top where lines
            cross. SVG paints in document order, so the reference lines
            declared after these stay legible over the series. */}
          {[...series].reverse().flatMap((s, i) => {
            const worst = i === series.length - 1;
            const common = {
              name: s.label,
              type: "monotone" as const,
              stroke: s.color,
              strokeWidth: worst ? 2 : 1.5,
              strokeOpacity: worst ? 1 : 0.55,
              dot: worst
                ? ({ r: 2.5, strokeWidth: 0, fill: s.color } as const)
                : (false as const),
              // Hover markers are drawn separately below; recharts' own
              // activeDot would be stuck in this line's layer, under the
              // reference rules.
              activeDot: false as const,
              isAnimationActive: false,
              connectNulls: true,
            };
            return [
              // Dashed = reconstructed (pre-epoch).
              <Line
                key={reconKey(s.dataKey)}
                dataKey={reconKey(s.dataKey)}
                strokeDasharray="4 3"
                {...common}
              />,
              <Line key={s.dataKey} dataKey={s.dataKey} {...common} />,
            ];
          })}
          {/* Painted over the series so a marker is never buried under a line
            that crosses it. Unlabelled: there can be dozens, and stacked
            labels would be unreadable; the key names them once. */}
          {eventMarks.map((m) => (
            <ReferenceLine
              key={m.key}
              x={m.t}
              stroke={EVENT_COLOR[m.type]}
              strokeDasharray={dashArray(EVENT_STROKE)}
              strokeWidth={EVENT_STROKE.width}
              strokeOpacity={EVENT_STROKE.opacity}
            />
          ))}
          {markerT && (
            <ReferenceLine
              x={markerT}
              stroke={APPLIED_COLOR}
              strokeDasharray="4 3"
              strokeWidth={1}
              label={{
                value: "applied",
                position: appliedLabelPosition,
                fontSize: 10,
                fill: APPLIED_COLOR,
              }}
            />
          )}
          {/* Drawn in front of the reference rules so a line on the exhausted
            floor or crossing an alert marker still shows its point. */}
          {pointHover !== null &&
            hoverMarkers({
              x: instants[pointHover.index].t,
              points: series.map((s) => ({
                key: s.dataKey,
                value: plottedPct(pointHover.index, s.dataKey),
                color: s.color,
              })),
              activeKeys: nearestKeys,
            })}
          {/* Transparent hit targets, painted last so they sit above the rules. */}
          {[...markerHits.values()].map((tip) => (
            <ReferenceLine
              key={`hit-${tip.t}`}
              x={tip.t}
              stroke="transparent"
              strokeWidth={MARKER_HIT_WIDTH}
              onMouseMove={(e) =>
                setMarkerHover({ x: e.clientX, y: e.clientY, tip })
              }
              onMouseLeave={() => setMarkerHover(null)}
            />
          ))}
        </LineChart>
      </ChartContainer>
      <ChartKey series={keySeries} marks={keyMarks} />
      {hiddenCount > 0 && (
        <p className="mt-1 text-[0.6875rem] text-muted-foreground">
          Showing the {shown.length} groups with the least budget left;{" "}
          {hiddenCount} more {hiddenCount === 1 ? "is" : "are"} not plotted.
        </p>
      )}
      {markerHover && (
        <CursorTooltip x={markerHover.x} y={markerHover.y}>
          <SeriesTooltipContent
            title={new Date(markerHover.tip.t).toLocaleString()}
            rows={markerHover.tip.rows}
          />
        </CursorTooltip>
      )}
      {pointHover && (
        <CursorTooltip x={pointHover.x} y={pointHover.y}>
          <SeriesTooltipContent
            title={
              <>
                {new Date(instants[pointHover.index].t).toLocaleString()}
                {hoveredIsReconstructed && (
                  <span className="italic">
                    {" "}
                    · reconstructed (predates this SLO)
                  </span>
                )}
              </>
            }
            rows={series.map((s) => {
              const p = s.points[pointHover.index];
              return {
                key: s.dataKey,
                color: s.color,
                label: s.label,
                active: nearestKeys.has(s.dataKey),
                // Same formatter as the inline meter, so one value is never
                // worded two ways.
                value:
                  p.valid === null
                    ? "no data"
                    : `${
                        p.budgetRemaining === null
                          ? "—"
                          : ccFmtBudgetRemaining(p.budgetRemaining)
                      } · ${fmtCount(p.good ?? 0)}/${fmtCount(p.valid)}`,
              };
            })}
          />
        </CursorTooltip>
      )}
    </>
  );
}
