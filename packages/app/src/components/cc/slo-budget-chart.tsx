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
  /** Plotted budget %, floored at FLOOR_PCT so the axis stays legible. */
  budgetPct: number | null;
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
   * instant, ISO 8601). One continuous line whose stroke turns from muted
   * (reconstructed history that predates the SLO) to solid (the real observed
   * budget) exactly at the epoch, with an "applied" marker there. Omit to draw a
   * fully solid line.
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
  const data: Row[] = points.map((p) => {
    const raw = p.budgetRemaining === null ? null : p.budgetRemaining * 100;
    return {
      t: p.t,
      budgetPct: raw === null ? null : Math.max(raw, FLOOR_PCT),
      rawPct: raw,
      synthetic: hasEpoch && Date.parse(p.t) < epochMs,
      good: p.good,
      valid: p.valid,
    };
  });
  // Gradient split point as a fraction of the plotted range. The instants span
  // [first, last] evenly, so the epoch's time-fraction is its x-fraction; a hard
  // two-stop gradient at this offset turns the single stroke muted -> solid
  // exactly at the epoch (0 = all real, 1 = all reconstructed).
  const firstT = Date.parse(points[0].t);
  const lastT = Date.parse(points[points.length - 1].t);
  const splitOffset =
    hasEpoch && lastT > firstT
      ? Math.min(1, Math.max(0, (epochMs - firstT) / (lastT - firstT)))
      : 0;
  // The "applied" marker sits on the first real point, shown only when the split
  // actually falls inside the range (some reconstructed points precede it).
  const firstRealIdx = hasEpoch
    ? points.findIndex((p) => Date.parse(p.t) >= epochMs)
    : 0;
  const markerT = firstRealIdx > 0 ? points[firstRealIdx].t : null;

  return (
    <ChartContainer config={chartConfig} className="h-[240px] w-full">
      <LineChart data={data} margin={{ left: 12, right: 12, top: 8 }}>
        {/* Muted (reconstructed) up to the epoch, solid (real) after it, as one
            hard-edged two-stop gradient along the x axis. */}
        <defs>
          <linearGradient id="cc-budget-split" x1="0" y1="0" x2="1" y2="0">
            <stop
              offset={splitOffset}
              stopColor="var(--color-budgetPct)"
              stopOpacity={0.32}
            />
            <stop
              offset={splitOffset}
              stopColor="var(--color-budgetPct)"
              stopOpacity={1}
            />
          </linearGradient>
        </defs>
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
              formatter={(_value, _name, item) => {
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
        {/* One continuous budget line; the gradient stroke carries the
            reconstructed -> real transition. Dots mark only the real, observed
            points, so reconstructed history reads as an inferred trend. */}
        <Line
          dataKey="budgetPct"
          type="monotone"
          stroke="url(#cc-budget-split)"
          strokeWidth={2}
          dot={(props: { cx?: number; cy?: number; payload?: Row }) => {
            const { cx, cy, payload } = props;
            if (
              payload?.synthetic ||
              cx === undefined ||
              cy === undefined ||
              payload?.budgetPct === null
            ) {
              return <g />;
            }
            return (
              <circle cx={cx} cy={cy} r={2.5} fill="var(--color-budgetPct)" />
            );
          }}
          isAnimationActive={false}
          connectNulls
        />
      </LineChart>
    </ChartContainer>
  );
}
