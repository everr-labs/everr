import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import { ChartEmptyState } from "@/components/ui/chart-helpers";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ScatterPoint } from "@/data/test-performance";
import { formatDurationCompact, formatRelativeTime } from "@/lib/formatting";

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
    point.testName.length > 360
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
  const [selected, setSelected] = useState<ScatterPoint | null>(null);

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
    if (entry) {
      setSelected(entry);
    }
  };

  return (
    <>
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
          <ZAxis range={[50, 50]} />
          <Tooltip content={<ScatterTooltipContent />} />
          <Legend />
          <Scatter
            name="main (pass)"
            data={mainPass}
            fill="var(--color-mainPass)"
            stroke="#000"
            strokeWidth={1}
            shape="circle"
            legendType="circle"
            onClick={(e) => handleClick(e as unknown as ScatterPointWithTs)}
            cursor="pointer"
            isAnimationActive={false}
          />
          <Scatter
            name="main (fail)"
            data={mainFail}
            fill="var(--color-mainFail)"
            stroke="#000"
            strokeWidth={1}
            shape="circle"
            legendType="circle"
            onClick={(e) => handleClick(e as unknown as ScatterPointWithTs)}
            cursor="pointer"
            isAnimationActive={false}
          />
          <Scatter
            name="branch (pass)"
            data={otherPass}
            fill="var(--color-otherPass)"
            stroke="#000"
            strokeWidth={0.5}
            shape="triangle"
            legendType="triangle"
            opacity={1}
            onClick={(e) => handleClick(e as unknown as ScatterPointWithTs)}
            cursor="pointer"
            isAnimationActive={false}
          />
          <Scatter
            name="branch (fail)"
            data={otherFail}
            fill="var(--color-otherFail)"
            stroke="#000"
            strokeWidth={1}
            shape="triangle"
            legendType="triangle"
            opacity={1}
            onClick={(e) => handleClick(e as unknown as ScatterPointWithTs)}
            cursor="pointer"
            isAnimationActive={false}
          />
        </ScatterChart>
      </ChartContainer>

      <Sheet
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <SheetContent>
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>Test Execution Details</SheetTitle>
                <SheetDescription className="font-mono break-all">
                  {selected.testName}
                </SheetDescription>
              </SheetHeader>
              <div className="grid gap-4 px-6 py-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Result</p>
                    <p
                      className={`font-medium ${selected.result === "pass" ? "text-green-600" : "text-red-600"}`}
                    >
                      {selected.result}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Duration</p>
                    <p className="font-mono">
                      {formatDurationCompact(selected.duration, "s")}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Branch</p>
                    <p>{selected.branch}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Repository</p>
                    <p>{selected.repo}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Commit</p>
                    <p className="font-mono">
                      {selected.commitSha.slice(0, 7)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">When</p>
                    <p>{formatRelativeTime(selected.timestamp)}</p>
                  </div>
                </div>
                <Button
                  className="w-full"
                  variant="outline"
                  render={
                    <Link
                      to="/dashboard/runs/$traceId"
                      params={{ traceId: selected.traceId }}
                    />
                  }
                >
                  <ExternalLink className="size-4" />
                  View CI Run
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
