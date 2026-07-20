// packages/app/src/components/cc/slo-budget-chart.tsx
//
// The error budget over time: a burn-down line of budget remaining (100% = full
// budget, 0% = exhausted, below 0 = overspent), reconstructed from the raw
// (good, valid) sample gauges the engine records each evaluation tick. This is
// the SLO's slow-moving trend; the status hero shows the current instant and the
// per-tier burn pressure, so here one calm line answers "which way is it going".
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
  good: number;
  valid: number;
};

/** "1,234" — event counts in the tooltip stay readable at scale. */
const fmtCount = (n: number) => n.toLocaleString();

export function SloBudgetChart({ points }: { points: CcSloBudgetPoint[] }) {
  if (points.length === 0) {
    return (
      <ChartEmptyState message="No budget samples recorded in this range yet" />
    );
  }
  const data: Row[] = points.map((p) => {
    const raw = p.budgetRemaining === null ? null : p.budgetRemaining * 100;
    return {
      t: p.t,
      budgetPct: raw === null ? null : Math.max(raw, FLOOR_PCT),
      rawPct: raw,
      good: p.good,
      valid: p.valid,
    };
  });

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
                  </div>
                );
              }}
            />
          }
        />
        <Line
          dataKey="budgetPct"
          type="monotone"
          stroke="var(--color-budgetPct)"
          strokeWidth={2}
          // Budget samples are sparse (the window recomputes slowly), so show a
          // dot per point — a single sample must still be visible as a mark.
          dot={{ r: 2.5, strokeWidth: 0, fill: "var(--color-budgetPct)" }}
          isAnimationActive={false}
          connectNulls
        />
      </LineChart>
    </ChartContainer>
  );
}
