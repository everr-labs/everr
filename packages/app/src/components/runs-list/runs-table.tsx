import { ConclusionIcon } from "@everr/telemetry-explorer/runs";
import { Badge } from "@everr/ui/components/badge";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Empty, EmptyDescription } from "@everr/ui/components/empty";
import { formatDuration } from "@everr/ui/lib/formatting";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import type { RunListItem } from "@/data/runs-list/schemas";
import { formatCost } from "@/lib/runner-pricing";

interface RunsTableProps {
  data: (RunListItem & { estimatedCost?: number })[];
  /** Show an "Est. Cost" column, read from each row's `estimatedCost`. */
  showCost?: boolean;
}

export function RunsTable({ data, showCost = false }: RunsTableProps) {
  const columns = useMemo<Column<RunListItem & { estimatedCost?: number }>[]>(
    () => [
      {
        header: "Status",
        cell: (run) => (
          <ConclusionIcon conclusion={run.conclusion} className="size-4" />
        ),
      },
      {
        header: "Run ID",
        cell: (run) => (
          <Link
            to="/runs/$traceId"
            params={{ traceId: run.traceId }}
            className="font-mono text-xs hover:underline"
          >
            {run.runId}
            {run.runAttempt > 1 && (
              <span className="text-muted-foreground ml-1">
                (#{run.runAttempt})
              </span>
            )}
          </Link>
        ),
      },
      {
        header: "Branch",
        cell: (run) => (
          <Link
            to="/runs"
            search={(prev) => ({ ...prev, branches: [run.branch] })}
          >
            <Badge
              variant="outline"
              className="inline-block max-w-[10rem] cursor-pointer truncate align-middle hover:bg-accent"
              title={run.branch}
            >
              {run.branch}
            </Badge>
          </Link>
        ),
      },
      {
        header: "Duration",
        cell: (run) => (
          <span className="font-mono text-xs">
            {run.duration > 0 ? formatDuration(run.duration, "ms") : "—"}
          </span>
        ),
      },
      ...(showCost
        ? [
            {
              header: "Est. Cost",
              className: "pb-2 pr-4 text-right",
              cellClassName:
                "py-2 pr-4 text-right font-mono text-xs tabular-nums",
              cell: (run: RunListItem & { estimatedCost?: number }) =>
                formatCost(run.estimatedCost ?? 0),
            } satisfies Column<RunListItem & { estimatedCost?: number }>,
          ]
        : []),
      {
        header: "When",
        cell: (run) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {formatRelativeTime(run.timestamp)}
          </span>
        ),
      },
    ],
    [showCost],
  );

  return (
    <DataTable
      data={data}
      columns={columns}
      rowKey={(run) => run.traceId}
      emptyState={
        <Empty>
          <EmptyDescription>No runs found</EmptyDescription>
        </Empty>
      }
    />
  );
}
