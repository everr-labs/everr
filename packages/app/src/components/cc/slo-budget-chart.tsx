// packages/app/src/components/cc/slo-budget-chart.tsx
//
// The error budget over time: 100% is a full budget, 0% is gone. Computed at
// read time by replaying the SLI over a trailing window at each point
// (slo-series.server.ts). This is the SLO's slow-moving trend; the status hero
// shows the current instant and the per-tier burn pressure. Overspend is real
// but unbounded, so it rests on the floor here and is reported in the tooltip.
//
// One line PER SLI GROUP. A grouped SLO promises its target to each group
// separately and the engine fires per group, so a single pooled line would let
// one high-volume healthy group hold the chart near 100% while another sat far
// past its own line — and would disagree with the hero, which reads the worst
// group. The worst group is drawn at full weight so the chart still leads with
// what the hero names; the rest recede but stay visible.
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
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { ccFmtBudgetRemaining } from "@/components/cc/budget-bar";
import { CursorTooltip } from "@/components/cursor-tooltip";
import type { CcSloBudgetGroupSeries } from "@/data/cc/slo-series.server";
import { SERIES_COLORS } from "../dashboards/visualizations/data-utils";
import {
  SeriesTooltipContent,
  type SeriesTooltipRow,
} from "../dashboards/visualizations/series-tooltip";

// The axis is the budget itself: 100% is full, 0% is gone, and there is nothing
// below gone. Overspend is unbounded (a budget can read -99900%), so plotting it
// literally would crush every other line against an absurd axis; a group past
// its line rests on the floor instead, and the tooltip reports how far past.
const FLOOR_PCT = 0;
const CEIL_PCT = 100;

// Plot geometry, declared rather than measured. recharts hands `chartY` to the
// mouse handler but not the plot rect (its `offset` is absent from that
// payload), and mapping a cursor height back to a budget needs both. So the
// three numbers that decide the plot box are fixed here and fed to the chart,
// instead of being read back from the DOM on every mouse move.
const CHART_H = 240;
const MARGIN_TOP = 8;
const XAXIS_H = 30;
const PLOT_TOP = MARGIN_TOP;
const PLOT_H = CHART_H - MARGIN_TOP - XAXIS_H;

/** A vertical pixel distance as a budget percentage on this plot. */
const pctPerPx = (px: number) => (px / PLOT_H) * (CEIL_PCT - FLOOR_PCT);

// Hover markers this close together visibly overlap, so every series within
// this distance of the nearest one is highlighted rather than just the single
// closest. Matches the highlighted marker's radius.
const HOVER_TIE_PX = 6;

const EMPTY_KEYS: ReadonlySet<string> = new Set();

/**
 * Every series whose plotted value is nearest the cursor — PLURAL, because the
 * overlap this exists to resolve is usually a tie. Two groups both sitting at
 * 100%, or both resting on the exhausted floor, are equally near the pointer,
 * and singling out one of them would be arbitrary and would hide the other.
 * Anything within `tolerancePct` of the closest counts as tied too: at that
 * distance the markers visibly overlap, so the card has to name them all.
 *
 * Series with no measurement at this instant are never nearest to anything.
 */
export function ccNearestSeries(
  points: readonly { key: string; pct: number | null }[],
  cursorPct: number | null,
  tolerancePct: number,
): ReadonlySet<string> {
  if (cursorPct === null) return EMPTY_KEYS;
  let nearest = Number.POSITIVE_INFINITY;
  for (const p of points) {
    if (p.pct !== null)
      nearest = Math.min(nearest, Math.abs(p.pct - cursorPct));
  }
  if (!Number.isFinite(nearest)) return EMPTY_KEYS;
  const keys = new Set<string>();
  for (const p of points) {
    if (
      p.pct !== null &&
      Math.abs(p.pct - cursorPct) <= nearest + tolerancePct
    ) {
      keys.add(p.key);
    }
  }
  return keys;
}

// As many lines as the shared palette has distinct colours. Past this a budget
// chart stops being readable, so the worst groups win the slots and the caller
// is told how many were left off — a hidden group is the exact failure this
// chart exists to prevent.
const MAX_SERIES = SERIES_COLORS.length;

/** An alert transition to overlay on the budget line as a vertical marker. */
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

// A 1px dashed rule is far too thin to hover, so each marker instant also gets
// an invisible wide line over it as the hit target. `transparent` is a paint
// value, so the stroke still hit-tests under the default `visiblePainted`.
const MARKER_HIT_WIDTH = 14;

/** "1,234" — event counts in the tooltip stay readable at scale. */
const fmtCount = (n: number) => n.toLocaleString();

/**
 * What one line is called. A grouped SLO names the group, since telling the
 * lines apart is the whole point. A scalar SLO has no group to name and only
 * one line, so naming it after the quantity is the only useful thing to say —
 * "all traffic" would answer a question nobody asked, and would be wrong about
 * SLIs that count log records or seconds rather than requests.
 */
function seriesLabel(labels: Record<string, string>): string {
  const values = Object.values(labels);
  return values.length === 0 ? "Budget remaining" : values.join(", ");
}

/** The group's latest measured budget, for ranking. Null sorts as healthiest. */
function currentBudget(group: CcSloBudgetGroupSeries): number {
  for (let i = group.points.length - 1; i >= 0; i--) {
    const b = group.points[i].budgetRemaining;
    if (b !== null) return b;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * The chart's key. It names every group on the plot, plus the marks that repeat
 * (alert transitions) and so cannot carry inline labels. The once-per-chart
 * marks — "applied", the "exhausted" line, the reconstructed band — label
 * themselves on the plot instead and are deliberately absent here.
 */
function ChartKey({
  items,
}: {
  items: { label: string; color: string; dashed?: boolean }[];
}) {
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem] text-muted-foreground">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-0 w-4 shrink-0 border-t-2"
            style={{
              borderColor: it.color,
              borderStyle: it.dashed ? "dashed" : "solid",
            }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** What one marker instant reports on hover: everything that happened there. */
type MarkerTip = { t: string; rows: SeriesTooltipRow[] };

export function SloBudgetChart({
  groups,
  epoch,
  events,
}: {
  /** One series per SLI group, all on the same instant grid. */
  groups: CcSloBudgetGroupSeries[];
  /**
   * When the budget's meaning begins (the SLO's apply / last significant-edit
   * instant, ISO 8601). Everything before it is reconstructed from telemetry
   * that predates the SLO, so it sits inside a shaded band behind an "applied"
   * marker. Omit to treat the whole range as observed.
   */
  epoch?: string;
  /**
   * Alert transitions (a burn tier firing / resolving) to overlay as vertical
   * markers, each snapped to the nearest plotted instant. Red = firing, green =
   * resolved.
   */
  events?: SloBudgetEvent[];
}) {
  // The hovered point: viewport coords (for the cursor-following card) + the
  // data-row index recharts reports. Drives the shared CursorTooltip below.
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    index: number;
    /** The cursor's height read as a budget %, or null if unmeasurable. */
    pct: number | null;
  } | null>(null);
  // A hovered vertical marker takes precedence over the point readout: the
  // pointer is on the bar, so the bar is what the card should describe.
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

  // Worst budget first, so the group the hero names takes slot 0: it gets the
  // emphasis below, and it is the one that survives the MAX_SERIES cut.
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

  // One recharts row per instant, carrying every series' floored value. True
  // (unfloored) values stay out of the rows and are read from `shown` by index
  // when the tooltip needs them.
  const data = instants.map((_, pointIdx) => {
    const row: Record<string, string | number | null> = {
      t: instants[pointIdx].t,
    };
    for (const s of series) {
      const raw = s.points[pointIdx].budgetRemaining;
      row[s.dataKey] =
        raw === null
          ? null
          : Math.min(CEIL_PCT, Math.max(raw * 100, FLOOR_PCT));
    }
    return row;
  });

  const epochMs = epoch ? Date.parse(epoch) : Number.NaN;
  const hasEpoch = Number.isFinite(epochMs);
  // First instant on/after the epoch: the boundary. Everything before it is
  // reconstructed; -1 means the whole range predates the epoch.
  const boundary = hasEpoch
    ? instants.findIndex((p) => Date.parse(p.t) >= epochMs)
    : 0;
  // The "applied" marker sits on the boundary, but only when it falls inside
  // the range: boundary 0 is off the left edge, -1 is off the right.
  const markerT = boundary > 0 ? instants[boundary].t : null;
  // The reconstructed span, shaded rather than dashed: the epoch is a property
  // of the SLO, not of any one group, so one band says it once instead of every
  // line having to carry a second dashed copy of itself.
  const reconstructedTo =
    boundary === -1 ? instants[instants.length - 1].t : markerT;

  // Overlaid vertical markers sit on the categorical X axis, so a marker can
  // only land on an existing tick: snap an instant (ms) to its nearest plotted
  // point's `t`, or null when it falls outside the plotted range.
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

  // Alert transitions overlaid as vertical markers, deduped by (instant, type)
  // so a tick with several same-type transitions draws one bar, not a stack.
  // The tiers behind each bar are kept for the marker's tooltip: the bar says
  // something happened, the tooltip says which tier and when.
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
  // the same tick, and two overlapping hit lines would fight for the pointer.
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

  const keyItems = [
    ...series.map((s) => ({ label: s.label, color: s.color })),
    ...(eventMarks.some((m) => m.type === "firing")
      ? [{ label: "Alert fired", color: EVENT_COLOR.firing, dashed: true }]
      : []),
    ...(eventMarks.some((m) => m.type === "resolved")
      ? [{ label: "Alert resolved", color: EVENT_COLOR.resolved, dashed: true }]
      : []),
  ];

  const nearestKeys =
    hover === null
      ? EMPTY_KEYS
      : ccNearestSeries(
          series.map((s) => {
            const v = data[hover.index]?.[s.dataKey];
            return { key: s.dataKey, pct: typeof v === "number" ? v : null };
          }),
          hover.pct,
          pctPerPx(HOVER_TIE_PX),
        );
  // A marker hover owns the card, so the point readout stands down for it.
  const pointHover = markerHover === null ? hover : null;

  const hoveredIsReconstructed =
    hover !== null &&
    boundary !== 0 &&
    (boundary === -1 || hover.index < boundary);

  return (
    <>
      <ChartContainer
        // Empty: ChartContainer's config exists to emit `--color-<key>` vars
        // for a fixed series set, and these series are discovered at runtime,
        // so each Line carries its own colour instead.
        config={{}}
        className="w-full"
        style={{ height: CHART_H }}
      >
        <LineChart
          data={data}
          margin={{ left: 12, right: 12, top: 8 }}
          // recharts does the hit-testing (nearest point -> activeTooltipIndex);
          // the native event carries the viewport coords the portaled card needs.
          onMouseMove={(state, e) => {
            const i = state?.activeTooltipIndex;
            if (
              !(state?.isTooltipActive && typeof i === "number" && i >= 0 && e)
            ) {
              setHover(null);
              return;
            }
            // Turn the pointer's height into a budget value so the nearest
            // series can be singled out. The y axis is linear over
            // [FLOOR_PCT, CEIL_PCT] across the plot box declared above.
            const cy = state.chartY;
            const pct =
              typeof cy === "number"
                ? CEIL_PCT - ((cy - PLOT_TOP) / PLOT_H) * (CEIL_PCT - FLOOR_PCT)
                : null;
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
            // Full budget at the top, exhausted at the bottom. The axis has
            // the same bounds as the quantity, so a line's height IS the budget
            // and the floor is a real limit rather than a chosen viewport.
            domain={[FLOOR_PCT, CEIL_PCT]}
            tickFormatter={(v: number) => `${v}%`}
          />
          {/* Everything left of the epoch is inferred from telemetry that
            predates the SLO. Shaded once for the whole plot rather than dashed
            per line, which keeps it readable at any group count. */}
          {reconstructedTo && (
            <ReferenceArea
              x1={instants[0].t}
              x2={reconstructedTo}
              fill="var(--muted-foreground)"
              // Enough wash to read as a region without competing with the
              // lines over it; below ~0.1 it vanishes on the dark card.
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
          {/* Drives recharts' active index (and active dot); the visible card is
            the portaled CursorTooltip below, shared with the dashboard charts.
            No cursor line — the dashboard tooltip highlights the point, not a
            crosshair, and we match its behavior. */}
          <ChartTooltip cursor={false} content={() => null} />
          {/* Painted worst-last so the group the hero names sits on top of the
            healthier ones wherever they cross. The reference lines below are
            declared after these: SVG paints in document order, so the fixed
            references (exhausted, applied, alert transitions) stay legible
            wherever a series would otherwise cover them. */}
          {[...series].reverse().map((s, i) => {
            const worst = i === series.length - 1;
            return (
              <Line
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.label}
                type="monotone"
                stroke={s.color}
                strokeWidth={worst ? 2 : 1.5}
                strokeOpacity={worst ? 1 : 0.55}
                dot={worst ? { r: 2.5, strokeWidth: 0, fill: s.color } : false}
                // The hover markers are drawn separately below, in front of
                // everything; recharts' own activeDot would be stuck inside this
                // line's layer, under the reference rules.
                activeDot={false}
                isAnimationActive={false}
                connectNulls
              />
            );
          })}
          {/* Exhausted is now the axis floor rather than a level inside the
            plot, so this tints that floor and names it instead of ruling across
            the chart. A line resting here has no budget left. */}
          <ReferenceLine
            y={0}
            stroke="var(--destructive)"
            strokeWidth={1}
            strokeOpacity={0.7}
            label={{
              value: "exhausted",
              position: "insideBottomLeft",
              fontSize: 10,
              fill: "var(--destructive)",
            }}
          />
          {/* Alert transitions: a burn tier firing (red) or resolving (green),
            snapped to the nearest instant. Thin and semi-transparent so they
            read as annotation rather than data, but painted over the series so
            a marker is never buried under a line that happens to cross it.
            Unlabelled by construction — there can be dozens, and stacked labels
            would be unreadable; the key below the chart names them once. */}
          {eventMarks.map((m) => (
            <ReferenceLine
              key={m.key}
              x={m.t}
              stroke={EVENT_COLOR[m.type]}
              strokeDasharray="2 2"
              strokeWidth={1}
              strokeOpacity={0.6}
            />
          ))}
          {/* When the budget became real. One per chart, so it labels itself. */}
          {markerT && (
            <ReferenceLine
              x={markerT}
              stroke={APPLIED_COLOR}
              strokeDasharray="4 3"
              strokeWidth={1}
              label={{
                value: "applied",
                position: "insideTopLeft",
                fontSize: 10,
                fill: APPLIED_COLOR,
              }}
            />
          )}
          {/* One marker per line at the hovered instant, so every row of the
            tooltip can be traced to a point. `isFront` puts them above the
            series AND the reference rules — a value sitting on the exhausted
            floor or under an alert marker still shows where it is. The ring is
            the card colour, not recharts' hardcoded white, so it reads on
            either theme. */}
          {pointHover !== null &&
            // Highlighted markers drawn last, so a called-out point is never
            // buried under a plain one it shares a position with.
            [...series]
              .sort(
                (a, b) =>
                  Number(nearestKeys.has(a.dataKey)) -
                  Number(nearestKeys.has(b.dataKey)),
              )
              .map((s) => {
                const y = data[pointHover.index]?.[s.dataKey];
                if (typeof y !== "number") return null;
                return (
                  <ReferenceDot
                    key={`hover-${s.dataKey}`}
                    x={instants[pointHover.index].t}
                    y={y}
                    r={nearestKeys.has(s.dataKey) ? 6 : 4}
                    fill={s.color}
                    stroke="var(--card)"
                    strokeWidth={2}
                    isFront
                    // Never swallow a pointer heading for a marker's hit line.
                    style={{ pointerEvents: "none" }}
                  />
                );
              })}
          {/* Hit targets, painted last of all so they sit above the rules.
            Transparent and wide enough to hover; each reports everything that
            happened at its instant. */}
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
      <ChartKey items={keyItems} />
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
                // The same formatter the inline meter uses, so the tooltip
                // and the meter never word one value two ways.
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
