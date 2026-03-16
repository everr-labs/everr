import { type Column, DataTable } from "@/components/ui/data-table";
import type { RunnerFlakiness } from "@/data/flaky-tests/schemas";
import { formatDuration, getFailureRateColor } from "@/lib/formatting";
import { cn } from "@/lib/utils";

interface RunnerFlakinessTableProps {
  data: RunnerFlakiness[];
}

const columns: Column<RunnerFlakiness>[] = [
  {
    header: "Runner",
    cell: (runner) => (
      <span className="font-medium">{runner.runnerName || "Unknown"}</span>
    ),
  },
  {
    header: "Failure Rate",
    cell: (runner) => (
      <>
        <span
          className={cn(
            "font-mono font-medium",
            runner.failureRate > 0
              ? getFailureRateColor(runner.failureRate)
              : "text-green-600",
          )}
        >
          {runner.failureRate}%
        </span>
        <span className="text-muted-foreground text-xs ml-2">
          ({runner.failCount}F / {runner.passCount}P)
        </span>
      </>
    ),
  },
  {
    header: "Executions",
    cell: (runner) => (
      <span className="font-mono text-xs">{runner.totalExecutions}</span>
    ),
  },
  {
    header: "Avg Duration",
    cell: (runner) => (
      <span className="font-mono text-xs">
        {formatDuration(runner.avgDuration)}
      </span>
    ),
  },
];

export function RunnerFlakinessTable({ data }: RunnerFlakinessTableProps) {
  return (
    <DataTable
      data={data}
      columns={columns}
      rowKey={(runner) => runner.runnerName}
      emptyState={
        <div className="flex h-[100px] items-center justify-center text-muted-foreground text-sm">
          No runner data available
        </div>
      }
    />
  );
}
