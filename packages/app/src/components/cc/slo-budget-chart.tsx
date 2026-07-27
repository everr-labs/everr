// packages/app/src/components/cc/slo-budget-chart.tsx
//
// The error budget over time: a burn-down line of budget remaining (100% = full
// budget, 0% = exhausted, below 0 = overspent), computed at read time by
// replaying the SLI over a trailing window at each point (slo-series.server.ts).
// This is the SLO's slow-moving trend; the status hero shows the current instant
// and the per-tier burn pressure, so here one calm line answers "which way is it
// going".
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@everr/ui/components/chart";
import {
  ChartEmptyState,
  formatChartDate,
} from "@everr/ui/components/chart-helpers";
import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { ccFmtBudgetRemaining } from "@/components/cc/budget-bar";
import { CursorTooltip } from "@/components/cursor-tooltip";
import type { CcSloBudgetPoint } from "@/data/cc/slo-series.server";
import { SeriesTooltipContent } from "../dashboards/visualizations/series-tooltip";

// The budget line's color, referenced both by the chart (via ChartContainer's
// `--color-budgetPct`) and by the portaled tooltip swatch. The tooltip renders
// outside the chart's CSS scope, so it needs the literal value, not the var.
const BUDGET_COLOR = "hsl(160, 84%, 39%)";

const chartConfig = {
  budgetPct: { label: "Budget remaining", color: BUDGET_COLOR },
} satisfies ChartConfig;

// A badly-overspent SLO's budget goes deeply negative (e.g. -99900%); plotting
// that literally would flatten every other point against an absurd axis. Pin the
// PLOTTED value to this floor so an exhausted line sits just under the 0% line
// and stays visible, while the tooltip still reports the true number.
const FLOOR_PCT = -25;

type Row = {
  t: string;
  /** Plotted budget % for the REAL (post-epoch) segment, floored at FLOOR_PCT. */
  realPct: number | null;
  /** Plotted budget % for the SYNTHETIC (pre-epoch, reconstructed) segment. */
  synthPct: number | null;
  /** True budget % for the tooltip (may be far below the floor). */
  rawPct: number | null;
  /** This point predates the budget epoch: reconstructed, not observed. */
  synthetic: boolean;
  good: number;
  valid: number;
};

/** An alert transition to overlay on the budget line as a vertical marker. */
export type SloBudgetEvent = {
  /** Instant of the transition, ISO 8601. */
  t: string;
  /** `firing` = a burn tier fired; `resolved` = it cleared. */
  type: "firing" | "resolved";
};

/** "1,234" — event counts in the tooltip stay readable at scale. */
const fmtCount = (n: number) => n.toLocaleString();

// Report the true budget as a number at every depth, on the same formatter the
// inline meter uses, so the tooltip and the meter never word the same value
// differently. `raw` is already a percentage, hence the /100.
function budgetValue(raw: number | null): string {
  if (raw == null) return "—";
  return ccFmtBudgetRemaining(raw / 100);
}

export function SloBudgetChart({
  points,
  epoch,
  events,
}: {
  points: CcSloBudgetPoint[];
  /**
   * When the budget's meaning begins (the SLO's apply / last significant-edit
   * instant, ISO 8601). Points before it are reconstructed from telemetry that
   * predates the SLO, so they render muted + dashed behind an "applied" marker;
   * points on/after it are the real observed budget. Omit to draw one solid line.
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
  } | null>(null);

  if (points.length === 0) {
    return (
      <ChartEmptyState message="No telemetry in this range to compute the budget" />
    );
  }
  const epochMs = epoch ? Date.parse(epoch) : Number.NaN;
  const hasEpoch = Number.isFinite(epochMs);
  // First point on/after the epoch: the boundary. Everything before it is
  // synthetic; -1 means the whole range predates the epoch (all synthetic).
  const boundary = hasEpoch
    ? points.findIndex((p) => Date.parse(p.t) >= epochMs)
    : 0;
  const data: Row[] = points.map((p, i) => {
    const raw = p.budgetRemaining === null ? null : p.budgetRemaining * 100;
    const plotted = raw === null ? null : Math.max(raw, FLOOR_PCT);
    const synthetic = hasEpoch && (boundary === -1 || i < boundary);
    return {
      t: p.t,
      realPct: synthetic ? null : plotted,
      // The synthetic segment also carries the boundary point so the two lines
      // meet with no gap where the budget becomes real.
      synthPct: synthetic || (boundary > 0 && i === boundary) ? plotted : null,
      rawPct: raw,
      synthetic,
      good: p.good,
      valid: p.valid,
    };
  });
  // The "applied" marker sits on the boundary point, but only when it falls
  // inside the range: boundary 0 is off the left edge, -1 is off the right.
  const markerT = boundary > 0 ? points[boundary].t : null;
  const tipRow = hover ? data[hover.index] : undefined;

  // Overlaid vertical markers sit on the categorical X axis, so a marker can
  // only land on an existing tick: snap an instant (ms) to its nearest plotted
  // point's `t`, or null when it falls outside the plotted range.
  const pointMs = points.map((p) => Date.parse(p.t));
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
    return points[idx].t;
  };

  // Alert transitions overlaid as vertical markers, deduped by (instant, type)
  // so a tick with several same-type transitions draws one bar, not a stack.
  const eventMarks: { key: string; t: string; type: "firing" | "resolved" }[] =
    [];
  if (events?.length) {
    const seen = new Set<string>();
    for (const ev of events) {
      const t = snapToPoint(Date.parse(ev.t));
      if (t === null) continue;
      const key = `${t}|${ev.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      eventMarks.push({ key, t, type: ev.type });
    }
  }

  return (
    <>
      <ChartContainer config={chartConfig} className="h-[240px] w-full">
        <LineChart
          data={data}
          margin={{ left: 12, right: 12, top: 8 }}
          // recharts does the hit-testing (nearest point -> activeTooltipIndex);
          // the native event carries the viewport coords the portaled card needs.
          onMouseMove={(state, e) => {
            const i = state?.activeTooltipIndex;
            setHover(
              state?.isTooltipActive && typeof i === "number" && i >= 0 && e
                ? { x: e.clientX, y: e.clientY, index: i }
                : null,
            );
          }}
          onMouseLeave={() => setHover(null)}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="t"
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
            // Full budget at the top, the overspend floor at the bottom; the 0%
            // exhaustion line always sits on screen between them.
            domain={[FLOOR_PCT, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />
          {/* Budget exhausted: the line crossing this is the whole story. */}
          <ReferenceLine
            y={0}
            stroke="var(--destructive)"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
          {/* Alert transitions: a burn tier firing (red) or resolving (green),
            snapped to the nearest instant. Thin + faint so the budget line and
            the applied marker stay dominant. */}
          {eventMarks.map((m) => (
            <ReferenceLine
              key={m.key}
              x={m.t}
              stroke={
                m.type === "firing"
                  ? "var(--color-red-500)"
                  : "var(--color-green-500)"
              }
              strokeDasharray="2 2"
              strokeWidth={1}
              strokeOpacity={0.6}
            />
          ))}
          {/* When the budget became real: everything left of this is reconstructed
            from telemetry that predates the SLO. */}
          {markerT && (
            <ReferenceLine
              x={markerT}
              stroke="var(--color-blue-500)"
              strokeDasharray="4 3"
              strokeWidth={1}
              label={{
                value: "applied",
                position: "insideTopLeft",
                fontSize: 10,
                fill: "var(--color-blue-500)",
              }}
            />
          )}
          {/* Drives recharts' active index (and active dot); the visible card is
            the portaled CursorTooltip below, shared with the dashboard charts.
            No cursor line — the dashboard tooltip highlights the point, not a
            crosshair, and we match its behavior. */}
          <ChartTooltip cursor={false} content={() => null} />
          {/* Reconstructed (pre-apply) budget: muted + dashed, no dots — inferred
            from telemetry that predates the SLO, not observed. */}
          <Line
            dataKey="synthPct"
            type="monotone"
            stroke="var(--color-budgetPct)"
            strokeOpacity={0.4}
            strokeDasharray="4 3"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          {/* Real (post-apply) budget: solid with a dot per point. */}
          <Line
            dataKey="realPct"
            type="monotone"
            stroke="var(--color-budgetPct)"
            strokeWidth={2}
            dot={{ r: 2.5, strokeWidth: 0, fill: "var(--color-budgetPct)" }}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ChartContainer>
      {hover && tipRow && (
        <CursorTooltip x={hover.x} y={hover.y}>
          <SeriesTooltipContent
            title={
              <>
                {new Date(tipRow.t).toLocaleString()}
                {tipRow.synthetic && (
                  <span className="italic">
                    {" "}
                    · reconstructed (predates this SLO)
                  </span>
                )}
              </>
            }
            rows={[
              {
                key: "budget",
                color: BUDGET_COLOR,
                label: "Budget remaining",
                value: budgetValue(tipRow.rawPct),
              },
              {
                key: "events",
                label: "Good / valid",
                value: `${fmtCount(tipRow.good)} / ${fmtCount(tipRow.valid)}`,
              },
            ]}
          />
        </CursorTooltip>
      )}
    </>
  );
}
