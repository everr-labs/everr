import { Badge } from "@everr/ui/components/badge";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Empty, EmptyDescription } from "@everr/ui/components/empty";
import { Sparkline } from "@everr/ui/components/sparkline";
import { formatDuration } from "@everr/ui/lib/formatting";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { DeltaIndicator } from "@/components/delta-indicator";
import type {
  WorkflowListItem,
  WorkflowSparklineData,
} from "@/data/workflows/schemas";
import { getSuccessRateVariant } from "@/lib/formatting";

interface WorkflowsTableProps {
  data: WorkflowListItem[];
  sparklines: WorkflowSparklineData[];
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
  const sparklineMap = new Map(
    sparklines.map((s) => [`${s.workflowName}:${s.repo}`, s]),
  );

  const sparkFor = (wf: WorkflowListItem) =>
    sparklineMap.get(`${wf.workflowName}:${wf.repo}`);

  const columns: Column<WorkflowListItem>[] = [
    {
      header: "Workflow",
      className: "pb-2 pl-3 pr-4 w-full",
      cellClassName: "py-2 pl-3 pr-4 w-full max-w-0",
      cell: (wf) => (
        <Link
          to="/workflows/$repo/$workflowName"
          params={{ repo: wf.repo, workflowName: wf.workflowName }}
          className="block truncate font-medium hover:underline"
          title={wf.workflowName}
        >
          {wf.workflowName}
        </Link>
      ),
    },
    {
      header: "Repository",
      cell: (wf) => (
        <span className="whitespace-nowrap text-muted-foreground">
          {wf.repo}
        </span>
      ),
    },
    {
      header: "Runs",
      cell: (wf) => (
        <SparklineCell
          sparkData={sparkFor(wf)?.buckets.map((b) => b.totalRuns) ?? []}
        >
          <div className="flex items-center gap-1.5">
            <span className="tabular-nums">{wf.totalRuns}</span>
            <DeltaIndicator
              current={wf.totalRuns}
              previous={wf.prevTotalRuns}
            />
          </div>
        </SparklineCell>
      ),
    },
    {
      header: "Success Rate",
      cell: (wf) => (
        <SparklineCell
          sparkData={sparkFor(wf)?.buckets.map((b) => b.successRate) ?? []}
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
      ),
    },
    {
      header: "Avg Duration",
      cell: (wf) => (
        <SparklineCell
          sparkData={sparkFor(wf)?.buckets.map((b) => b.avgDuration) ?? []}
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
      ),
    },
    {
      header: "Last Run",
      cell: (wf) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {wf.lastRunAt ? formatRelativeTime(wf.lastRunAt) : "—"}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      data={data}
      columns={columns}
      rowKey={(wf) => `${wf.workflowName}:${wf.repo}`}
      emptyState={
        <Empty>
          <EmptyDescription>No workflows found</EmptyDescription>
        </Empty>
      }
    />
  );
}
