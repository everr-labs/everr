import { Badge } from "@everr/ui/components/badge";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Empty, EmptyDescription } from "@everr/ui/components/empty";
import { formatDuration } from "@everr/ui/lib/formatting";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { Link } from "@tanstack/react-router";
import { ConclusionIcon } from "@/components/run-detail/conclusion-icon";
import { SenderCell } from "@/components/sender-cell";
import type { RunListItem } from "@/data/runs-list/schemas";

interface RunsTableProps {
  data: RunListItem[];
}

const columns: Column<RunListItem>[] = [
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
    header: "Workflow",
    className: "pb-2 pr-4 w-full",
    cellClassName: "py-2 pr-4 w-full max-w-0",
    cell: (run) => (
      <div className="truncate" title={run.workflowName}>
        {run.workflowName}
      </div>
    ),
  },
  {
    header: "Repository",
    cell: (run) => (
      <Link
        to="/repos"
        search={{ name: run.repo }}
        className="whitespace-nowrap hover:underline"
      >
        {run.repo}
      </Link>
    ),
  },
  {
    header: "Branch",
    cell: (run) => (
      <Link to="/runs" search={(prev) => ({ ...prev, branches: [run.branch] })}>
        <Badge variant="outline" className="cursor-pointer hover:bg-accent">
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
  {
    header: "When",
    cell: (run) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatRelativeTime(run.timestamp)}
      </span>
    ),
  },
  {
    header: "Sender",
    cell: (run) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        <SenderCell sender={run.sender} />
      </span>
    ),
  },
];

export function RunsTable({ data }: RunsTableProps) {
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
