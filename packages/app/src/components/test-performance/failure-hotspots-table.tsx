import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { type Column, DataTable } from "@/components/ui/data-table";
import { formatDuration, formatRelativeTime } from "@/lib/formatting";

export interface TestPerfFailureHotspot {
  testName: string;
  failureCount: number;
  latestTimestamp: string;
  avgDuration: number;
  latestTraceId: string;
}

interface TestPerfFailureHotspotsTableProps {
  data: TestPerfFailureHotspot[];
}

const columns: Column<TestPerfFailureHotspot>[] = [
  {
    header: "Test Name",
    cell: (row) => (
      <div className="max-w-72 truncate font-mono text-xs" title={row.testName}>
        {row.testName}
      </div>
    ),
  },
  {
    header: "Failures",
    cell: (row) => <span className="tabular-nums">{row.failureCount}</span>,
  },
  {
    header: "Avg Failure Duration",
    cell: (row) => (
      <span className="tabular-nums">
        {formatDuration(row.avgDuration, "s")}
      </span>
    ),
  },
  {
    header: "Last Seen",
    cell: (row) => (
      <span className="whitespace-nowrap text-muted-foreground">
        {formatRelativeTime(row.latestTimestamp)}
      </span>
    ),
  },
  {
    header: "Run",
    cell: (row) => (
      <Link
        to="/dashboard/runs/$traceId"
        params={{ traceId: row.latestTraceId }}
        className="inline-flex items-center hover:underline"
      >
        <ExternalLink className="size-3.5" />
      </Link>
    ),
  },
];

export function TestPerfFailureHotspotsTable({
  data,
}: TestPerfFailureHotspotsTableProps) {
  return (
    <DataTable
      data={data}
      columns={columns}
      rowKey={(row) => row.testName}
      emptyState={
        <p className="py-8 text-center text-muted-foreground">
          No failing tests in the selected scope
        </p>
      }
    />
  );
}
