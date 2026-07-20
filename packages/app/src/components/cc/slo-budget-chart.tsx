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
  ChartTooltipContent,
} from "@everr/ui/components/chart";
import {
  ChartEmptyState,
  formatChartDate,
} from "@everr/ui/components/chart-helpers";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import type { CcSloBudgetPoint } from "@/data/cc/slo-series.server";

const chartConfig = {
  budgetPct: { label: "Budget remaining", color: "hsl(160, 84%, 39%)" },
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

/** "1,234" — event counts in the tooltip stay readable at scale. */
const fmtCount = (n: number) => n.toLocaleString();

export function SloBudgetChart({
  points,
  epoch,
}: {
  points: CcSloBudgetPoint[];
  /**
   * When the budget's meaning begins (the SLO's apply / last significant-edit
   * instant, ISO 8601). Points before it are reconstructed from telemetry that
   * predates the SLO, so they render muted + dashed behind an "applied" marker;
   * points on/after it are the real observed budget. Omit to draw one solid line.
   */
  epoch?: string;
}) {
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

  return (
    <ChartContainer config={chartConfig} className="h-[240px] w-full">
      <LineChart data={data} margin={{ left: 12, right: 12, top: 8 }}>
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
        {/* When the budget became real: everything left of this is reconstructed
            from telemetry that predates the SLO. */}
        {markerT && (
          <ReferenceLine
            x={markerT}
            stroke="var(--muted-foreground)"
            strokeWidth={1}
            label={{
              value: "applied",
              position: "insideTopLeft",
              fontSize: 10,
              fill: "var(--muted-foreground)",
            }}
          />
        )}
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_label, payload) => {
                const t = payload?.[0]?.payload?.t as string | undefined;
                return t ? new Date(t).toLocaleString() : "";
              }}
              formatter={(_value, _name, item, index) => {
                // Both the synthetic and real series carry the boundary point,
                // so at the split they both appear in the tooltip payload. They
                // share one data row, so render it once (first item only) and
                // read from the row — never a doubled entry at the boundary.
                if (index !== 0) return null;
                const row = item?.payload as Row | undefined;
                const raw = row?.rawPct;
                // Report the true budget; a deeply overspent SLO reads as the
                // fact ("exhausted"), not an absurd negative percentage.
                const headline =
                  raw == null
                    ? "—"
                    : raw <= -100
                      ? "Budget exhausted"
                      : `${raw.toFixed(2)}% budget left`;
                return (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono tabular-nums">{headline}</span>
                    {row && (
                      <span className="text-[0.6875rem] text-muted-foreground">
                        {fmtCount(row.good)} good / {fmtCount(row.valid)} valid
                      </span>
                    )}
                    {row?.synthetic && (
                      <span className="text-[0.6875rem] text-muted-foreground italic">
                        reconstructed (predates this SLO)
                      </span>
                    )}
                  </div>
                );
              }}
            />
          }
        />
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
  );
}
