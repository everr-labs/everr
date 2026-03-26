import { Button } from "@everr/ui/components/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
} from "@everr/ui/components/chart";
import { ChartEmptyState } from "@everr/ui/components/chart-helpers";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@everr/ui/components/drawer";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { ScatterPoint } from "@/data/test-performance/metrics";
import { formatDurationCompact, formatRelativeTime } from "@/lib/formatting";

interface TestPerfScatterChartProps {
  data: ScatterPoint[];
  fromTimestamp: number;
  toTimestamp: number;
}

type ScatterPointWithTs = ScatterPoint & { ts: number; count: number };

const AGGREGATE_THRESHOLD = 200;
const TIME_BINS = 60;
const DURATION_BINS = 30;

/**
 * Spatially bins an array of points into a grid and merges nearby ones.
 * Points in the same (time_bin, duration_bin) cell are averaged into one
 * representative point whose `count` reflects how many were merged.
 */
function aggregateNearby(
  points: ScatterPointWithTs[],
  fromTs: number,
  toTs: number,
): ScatterPointWithTs[] {
  if (points.length === 0) return points;

  let minDur = Infinity;
  let maxDur = -Infinity;
  for (const p of points) {
    if (p.duration < minDur) minDur = p.duration;
    if (p.duration > maxDur) maxDur = p.duration;
  }

  const timeBinSize = (toTs - fromTs) / TIME_BINS || 1;
  const durBinSize = (maxDur - minDur) / DURATION_BINS || 1;

  const bins = new Map<string, ScatterPointWithTs[]>();

  for (const p of points) {
    const tx = Math.floor((p.ts - fromTs) / timeBinSize);
    const dy = Math.floor((p.duration - minDur) / durBinSize);
    const key = `${tx},${dy}`;
    const bin = bins.get(key);
    if (bin) bin.push(p);
    else bins.set(key, [p]);
  }

  const result: ScatterPointWithTs[] = [];
  for (const group of bins.values()) {
    if (group.length === 1) {
      result.push(group[0]);
    } else {
      const avgTs = group.reduce((s, p) => s + p.ts, 0) / group.length;
      const avgDur = group.reduce((s, p) => s + p.duration, 0) / group.length;
      result.push({
        ...group[0],
        ts: avgTs,
        duration: avgDur,
        count: group.length,
      });
    }
  }

  return result;
}

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
    point.testName.length > 45
      ? `${point.testName.slice(0, 42)}...`
      : point.testName;

  return (
    <div className="border-border/50 bg-background rounded-lg border px-2.5 py-1.5 text-xs shadow-xl min-w-48">
      <p className="font-medium mb-1 break-all">{displayName}</p>
      <div className="grid gap-0.5 text-muted-foreground">
        {point.count > 1 && (
          <p>
            Executions:{" "}
            <span className="text-foreground font-medium">{point.count}</span>
          </p>
        )}
        <p>
          Duration:{" "}
          <span className="text-foreground font-mono">
            {formatDurationCompact(point.duration, "s")}
            {point.count > 1 && " (avg)"}
          </span>
        </p>
        <p>
          Result:{" "}
          <span className={`font-medium ${resultColor}`}>{point.result}</span>
        </p>
        <p>
          Branch: <span className="text-foreground">{point.branch}</span>
        </p>
        {point.count === 1 && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}

export function TestPerfScatterChart({
  data,
  fromTimestamp,
  toTimestamp,
}: TestPerfScatterChartProps) {
  const [selected, setSelected] = useState<ScatterPointWithTs | null>(null);

  const shouldAggregate = data.length > AGGREGATE_THRESHOLD;
  const zRange: [number, number] = shouldAggregate ? [42, 260] : [42, 42];

  const { mainPass, mainFail, otherPass, otherFail } = useMemo(() => {
    const mainPass: ScatterPointWithTs[] = [];
    const mainFail: ScatterPointWithTs[] = [];
    const otherPass: ScatterPointWithTs[] = [];
    const otherFail: ScatterPointWithTs[] = [];

    for (const point of data) {
      const enriched: ScatterPointWithTs = {
        ...point,
        ts: new Date(point.timestamp).getTime(),
        count: 1,
      };
      const isMain = point.branch === "main";
      const isPass = point.result === "pass";

      if (isMain && isPass) mainPass.push(enriched);
      else if (isMain && !isPass) mainFail.push(enriched);
      else if (!isMain && isPass) otherPass.push(enriched);
      else otherFail.push(enriched);
    }

    if (!shouldAggregate) {
      return { mainPass, mainFail, otherPass, otherFail };
    }

    return {
      mainPass: aggregateNearby(mainPass, fromTimestamp, toTimestamp),
      mainFail: aggregateNearby(mainFail, fromTimestamp, toTimestamp),
      otherPass: aggregateNearby(otherPass, fromTimestamp, toTimestamp),
      otherFail: aggregateNearby(otherFail, fromTimestamp, toTimestamp),
    };
  }, [data, shouldAggregate, fromTimestamp, toTimestamp]);

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
            domain={[fromTimestamp, toTimestamp]}
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
          <ZAxis
            dataKey="count"
            type="number"
            range={zRange}
            scale={shouldAggregate ? "sqrt" : "linear"}
          />
          <ChartTooltip content={<ScatterTooltipContent />} />
          <ChartLegend />
          <Scatter
            name="main (pass)"
            data={mainPass}
            fill="var(--color-mainPass)"
            stroke="#000"
            strokeWidth={1}
            shape="circle"
            legendType="circle"
            onClick={handleClick}
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
            onClick={handleClick}
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
            onClick={handleClick}
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
            onClick={handleClick}
            cursor="pointer"
            isAnimationActive={false}
          />
        </ScatterChart>
      </ChartContainer>

      <Drawer
        swipeDirection="right"
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DrawerContent>
          {selected && (
            <>
              <DrawerHeader>
                <DrawerTitle>
                  {selected.count > 1
                    ? `${selected.count} Executions`
                    : "Test Execution Details"}
                </DrawerTitle>
                <DrawerDescription className="font-mono break-all">
                  {selected.testName}
                </DrawerDescription>
              </DrawerHeader>
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
                    <p className="text-muted-foreground text-xs">
                      {selected.count > 1 ? "Avg Duration" : "Duration"}
                    </p>
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
                  {selected.count === 1 && (
                    <>
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
                    </>
                  )}
                </div>
                {selected.count === 1 && (
                  <Button
                    className="w-full"
                    variant="outline"
                    nativeButton={false}
                    role="link"
                    render={
                      <Link
                        to="/runs/$traceId"
                        params={{ traceId: selected.traceId }}
                      />
                    }
                  >
                    <ExternalLink className="size-4" />
                    View CI Run
                  </Button>
                )}
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
