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

// Report the true budget as a number at every depth, on the same formatter the
// inline meter uses, so the tooltip and the meter never word the same value
// differently. `raw` is already a percentage, hence the /100.
function budgetValue(raw: number | null): string {
  if (raw == null) return "—";
  return ccFmtBudgetRemaining(raw / 100);
}

/**
 * The chart's key. Every mark that can appear more than once (alert
 * transitions) or that reads as a style rather than a label (the dashed
 * reconstructed segment) is named here, so nothing on the plot is left to a
 * tooltip. Entries are only rendered when that mark is actually on screen.
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
type MarkerTip = {
  t: string;
  rows: { key: string; color: string; label: string; value: string }[];
};

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
  // A hovered vertical marker takes precedence over the point readout: the
  // pointer is on the bar, so the bar is what the card should describe.
  const [markerHover, setMarkerHover] = useState<{
    x: number;
    y: number;
    tip: MarkerTip;
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

  // Named marks, in the order they read on the plot: the line itself, then what
  // interrupts it. Only what is actually drawn gets an entry.
  const hasSynthetic = data.some((r) => r.synthPct !== null);
  const keyItems = [
    { label: "Budget remaining", color: BUDGET_COLOR },
    ...(hasSynthetic
      ? [
          {
            label: "Reconstructed (predates this SLO)",
            color: BUDGET_COLOR,
            dashed: true,
          },
        ]
      : []),
    // No "applied" entry: that marker is one per chart and already carries its
    // own inline label, which is the rule the key exists to cover the gap in.
    ...(eventMarks.some((m) => m.type === "firing")
      ? [
          {
            label: "Alert fired",
            color: "var(--color-red-500)",
            dashed: true,
          },
        ]
      : []),
    ...(eventMarks.some((m) => m.type === "resolved")
      ? [
          {
            label: "Alert resolved",
            color: "var(--color-green-500)",
            dashed: true,
          },
        ]
      : []),
  ];

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
          {/* Budget exhausted: the line crossing this is the whole story. It
            is the one annotation that can carry its label inline without
            colliding, since it runs the full width at a fixed height. */}
          <ReferenceLine
            y={0}
            stroke="var(--destructive)"
            strokeDasharray="3 3"
            strokeWidth={1}
            label={{
              value: "exhausted",
              position: "insideBottomLeft",
              fontSize: 10,
              fill: "var(--destructive)",
            }}
          />
          {/* Alert transitions: a burn tier firing (red) or resolving (green),
            snapped to the nearest instant. Thin + faint so the budget line and
            the applied marker stay dominant. Unlabelled by construction — there
            can be dozens, and stacked labels would be unreadable; the key below
            the chart names them once. */}
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
            from telemetry that predates the SLO. One per chart, so it labels
            itself. */}
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
          {/* Hit targets, painted last so they sit above the visible rules.
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
      <ChartKey items={keyItems} />
      {markerHover && (
        <CursorTooltip x={markerHover.x} y={markerHover.y}>
          <SeriesTooltipContent
            title={new Date(markerHover.tip.t).toLocaleString()}
            rows={markerHover.tip.rows}
          />
        </CursorTooltip>
      )}
      {!markerHover && hover && tipRow && (
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
