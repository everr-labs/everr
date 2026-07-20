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

type Row = {
  t: string;
  budgetPct: number | null;
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
  const data: Row[] = points.map((p) => ({
    t: p.t,
    budgetPct: p.budgetRemaining === null ? null : p.budgetRemaining * 100,
    good: p.good,
    valid: p.valid,
  }));

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
          // Full budget at the top; drop to whatever the worst overspend reaches
          // (never above 0 as the floor) so exhaustion is always on screen.
          domain={[(min: number) => Math.floor(Math.min(0, min)), 100]}
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
              formatter={(value, _name, item) => {
                const row = item?.payload as Row | undefined;
                const pct =
                  typeof value === "number" ? `${value.toFixed(2)}%` : "—";
                return (
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono tabular-nums">
                      {pct} budget left
                    </span>
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
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
      </LineChart>
    </ChartContainer>
  );
}
