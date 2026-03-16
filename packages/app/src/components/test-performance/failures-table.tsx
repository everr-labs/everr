import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { type Column, DataTable } from "@/components/ui/data-table";
import type { TestFailure } from "@/data/test-performance";
import { formatDuration, formatRelativeTime } from "@/lib/formatting";

interface FailuresTableProps {
  data: TestFailure[];
}

const columns: Column<TestFailure>[] = [
  {
    header: "Test Name",
    cell: (row) => (
      <div className="max-w-64 truncate font-mono text-xs" title={row.testName}>
        {row.testName}
      </div>
    ),
  },
  {
    header: "When",
    cell: (row) => (
      <span className="whitespace-nowrap text-muted-foreground">
        {formatRelativeTime(row.timestamp)}
      </span>
    ),
  },
  {
    header: "Duration",
    cell: (row) => (
      <span className="tabular-nums">{formatDuration(row.duration, "s")}</span>
    ),
  },
  {
    header: "Branch",
    cell: (row) => <span className="text-xs">{row.branch}</span>,
  },
  {
    header: "Commit",
    cell: (row) => (
      <span className="font-mono text-xs">{row.commitSha.slice(0, 7)}</span>
    ),
  },
  {
    header: "Run",
    cell: (row) => (
      <Link
        to="/runs/$traceId"
        params={{ traceId: row.traceId }}
        className="inline-flex items-center hover:underline"
      >
        <ExternalLink className="size-3.5" />
      </Link>
    ),
  },
];

export function TestPerfFailuresTable({ data }: FailuresTableProps) {
  return (
    <DataTable
      data={data}
      columns={columns}
      rowKey={(row) => `${row.traceId}-${row.testName}`}
      emptyState={
        <p className="text-center text-muted-foreground py-8">
          No failures in the selected time range
        </p>
      }
    />
  );
}
