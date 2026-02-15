import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import { ChartEmptyState } from "@/components/ui/chart-helpers";
import type { ScatterPoint } from "@/data/test-performance";
import { formatDurationCompact } from "@/lib/formatting";

interface TestPerfScatterChartProps {
  data: ScatterPoint[];
}

type ScatterPointWithTs = ScatterPoint & { ts: number };

const chartConfig = {
  mainPass: { label: "main (pass)", color: "hsl(142, 71%, 45%)" },
  mainFail: { label: "main (fail)", color: "hsl(0, 84%, 60%)" },
  otherPass: { label: "branch (pass)", color: "hsl(142, 71%, 45%)" },
  otherFail: { label: "branch (fail)", color: "hsl(0, 84%, 60%)" },
} satisfies ChartConfig;

function formatTickDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ScatterTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ScatterPointWithTs }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  const resultColor =
    point.result === "pass" ? "text-green-600" : "text-red-600";
  const displayName =
    point.testName.length > 60
      ? `${point.testName.slice(0, 57)}...`
      : point.testName;

  return (
    <div className="border-border/50 bg-background rounded-lg border px-2.5 py-1.5 text-xs shadow-xl min-w-48">
      <p className="font-medium mb-1 break-all">{displayName}</p>
      <div className="grid gap-0.5 text-muted-foreground">
        <p>
          Duration:{" "}
          <span className="text-foreground font-mono">
            {formatDurationCompact(point.duration, "s")}
          </span>
        </p>
        <p>
          Result:{" "}
          <span className={`font-medium ${resultColor}`}>{point.result}</span>
        </p>
        <p>
          Branch: <span className="text-foreground">{point.branch}</span>
        </p>
        <p>
          Commit:{" "}
          <span className="text-foreground font-mono">
            {point.commitSha.slice(0, 7)}
          </span>
        </p>
        <p>
          Time:{" "}
          <span className="text-foreground">
            {new Date(point.timestamp).toLocaleString()}
          </span>
        </p>
      </div>
    </div>
  );
}

export function TestPerfScatterChart({ data }: TestPerfScatterChartProps) {
  const navigate = useNavigate();

  const { mainPass, mainFail, otherPass, otherFail } = useMemo(() => {
    const mainPass: ScatterPointWithTs[] = [];
    const mainFail: ScatterPointWithTs[] = [];
    const otherPass: ScatterPointWithTs[] = [];
    const otherFail: ScatterPointWithTs[] = [];

    for (const point of data) {
      const enriched: ScatterPointWithTs = {
        ...point,
        ts: new Date(point.timestamp).getTime(),
      };
      const isMain = point.branch === "main";
      const isPass = point.result === "pass";

      if (isMain && isPass) mainPass.push(enriched);
      else if (isMain && !isPass) mainFail.push(enriched);
      else if (!isMain && isPass) otherPass.push(enriched);
      else otherFail.push(enriched);
    }

    return { mainPass, mainFail, otherPass, otherFail };
  }, [data]);

  if (data.length === 0) {
    return (
      <ChartEmptyState message="No test executions match the current filters" />
    );
  }

  const handleClick = (entry: ScatterPointWithTs | undefined) => {
    if (entry?.traceId) {
      navigate({
        to: "/dashboard/runs/$traceId",
        params: { traceId: entry.traceId },
      });
    }
  };

  return (
    <ChartContainer config={chartConfig} className="h-[400px] w-full">
      <ScatterChart margin={{ top: 10, right: 12, bottom: 10, left: 12 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="ts"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={formatTickDate}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          dataKey="duration"
          type="number"
          tickFormatter={(v) => formatDurationCompact(v, "s")}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <ZAxis range={[30, 30]} />
        <Tooltip content={<ScatterTooltipContent />} />
        <Legend />
        <Scatter
          name="main (pass)"
          data={mainPass}
          fill="var(--color-mainPass)"
          shape="circle"
          onClick={(e) => handleClick(e as unknown as ScatterPointWithTs)}
          cursor="pointer"
          isAnimationActive={false}
        />
        <Scatter
          name="main (fail)"
          data={mainFail}
          fill="var(--color-mainFail)"
          shape="circle"
          onClick={(e) => handleClick(e as unknown as ScatterPointWithTs)}
          cursor="pointer"
          isAnimationActive={false}
        />
        <Scatter
          name="branch (pass)"
          data={otherPass}
          fill="var(--color-otherPass)"
          shape="triangle"
          opacity={0.6}
          onClick={(e) => handleClick(e as unknown as ScatterPointWithTs)}
          cursor="pointer"
          isAnimationActive={false}
        />
        <Scatter
          name="branch (fail)"
          data={otherFail}
          fill="var(--color-otherFail)"
          shape="triangle"
          opacity={0.6}
          onClick={(e) => handleClick(e as unknown as ScatterPointWithTs)}
          cursor="pointer"
          isAnimationActive={false}
        />
      </ScatterChart>
    </ChartContainer>
  );
}
