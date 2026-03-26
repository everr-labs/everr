import { Badge } from "@everr/ui/components/badge";
import { Empty, EmptyDescription } from "@everr/ui/components/empty";
import { Sparkline } from "@everr/ui/components/sparkline";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type {
  WorkflowListItem,
  WorkflowSparklineData,
} from "@/data/workflows/schemas";
import {
  formatDuration,
  formatRelativeTime,
  getSuccessRateVariant,
} from "@/lib/formatting";

interface WorkflowsTableProps {
  data: WorkflowListItem[];
  sparklines: WorkflowSparklineData[];
}

function DeltaIndicator({
  current,
  previous,
  invertColors = false,
}: {
  current: number;
  previous: number;
  invertColors?: boolean;
}) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0)
    return <span className="text-green-600 text-xs">new</span>;

  const delta = ((current - previous) / previous) * 100;
  if (Math.abs(delta) < 0.5) return null;

  const isPositive = delta > 0;
  // For duration, positive = bad (slower). For runs and success rate, positive = good.
  const isGood = invertColors ? !isPositive : isPositive;

  return (
    <span className={`text-xs ${isGood ? "text-green-600" : "text-red-600"}`}>
      {isPositive ? "+" : ""}
      {Math.round(delta)}%
    </span>
  );
}

function SparklineCell({
  children,
  sparkData,
  maxValue,
}: {
  children: ReactNode;
  sparkData: number[];
  maxValue?: number;
}) {
  return (
    <div className="relative">
      {sparkData.length > 0 && (
        <div className="pointer-events-none absolute inset-0 opacity-10">
          <Sparkline
            data={sparkData}
            className="h-full w-full"
            maxValue={maxValue}
          />
        </div>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}

export function WorkflowsTable({ data, sparklines }: WorkflowsTableProps) {
  if (data.length === 0) {
    return (
      <Empty>
        <EmptyDescription>No workflows found</EmptyDescription>
      </Empty>
    );
  }

  const sparklineMap = new Map(
    sparklines.map((s) => [`${s.workflowName}:${s.repo}`, s]),
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">Workflow</th>
            <th className="pb-2 pr-4 font-medium">Repository</th>
            <th className="pb-2 pr-4 font-medium">Runs</th>
            <th className="pb-2 pr-4 font-medium">Success Rate</th>
            <th className="pb-2 pr-4 font-medium">Avg Duration</th>
            <th className="pb-2 font-medium">Last Run</th>
          </tr>
        </thead>
        <tbody>
          {data.map((wf) => {
            const spark = sparklineMap.get(`${wf.workflowName}:${wf.repo}`);
            return (
              <tr
                key={`${wf.workflowName}:${wf.repo}`}
                className="border-b last:border-0 hover:bg-muted/50"
              >
                <td className="py-2 pr-4">
                  <Link
                    to="/workflows/$repo/$workflowName"
                    params={{ repo: wf.repo, workflowName: wf.workflowName }}
                    className="font-medium hover:underline"
                  >
                    {wf.workflowName}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-muted-foreground">{wf.repo}</td>
                <td className="py-2 pr-4">
                  <SparklineCell
                    sparkData={spark?.buckets.map((b) => b.totalRuns) ?? []}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="tabular-nums">{wf.totalRuns}</span>
                      <DeltaIndicator
                        current={wf.totalRuns}
                        previous={wf.prevTotalRuns}
                      />
                    </div>
                  </SparklineCell>
                </td>
                <td className="py-2 pr-4">
                  <SparklineCell
                    sparkData={spark?.buckets.map((b) => b.successRate) ?? []}
                    maxValue={100}
                  >
                    <div className="flex items-center gap-1.5">
                      <Badge variant={getSuccessRateVariant(wf.successRate)}>
                        {wf.successRate}%
                      </Badge>
                      <DeltaIndicator
                        current={wf.successRate}
                        previous={wf.prevSuccessRate}
                      />
                    </div>
                  </SparklineCell>
                </td>
                <td className="py-2 pr-4">
                  <SparklineCell
                    sparkData={spark?.buckets.map((b) => b.avgDuration) ?? []}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs tabular-nums">
                        {formatDuration(wf.avgDuration, "ms")}
                      </span>
                      <DeltaIndicator
                        current={wf.avgDuration}
                        previous={wf.prevAvgDuration}
                        invertColors
                      />
                    </div>
                  </SparklineCell>
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {wf.lastRunAt ? formatRelativeTime(wf.lastRunAt) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
