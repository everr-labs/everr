import { Badge } from "@everr/ui/components/badge";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Empty, EmptyDescription } from "@everr/ui/components/empty";
import { Link } from "@tanstack/react-router";
import { ConclusionIcon } from "@/components/run-detail/conclusion-icon";
import type { ActiveBranch } from "@/data/repo-detail/schemas";
import { formatRelativeTime, getSuccessRateVariant } from "@/lib/formatting";

interface ActiveBranchesTableProps {
  data: ActiveBranch[];
}

const columns: Column<ActiveBranch>[] = [
  {
    header: "Branch",
    cell: (branch) => <Badge variant="outline">{branch.branch}</Badge>,
  },
  {
    header: "Latest Status",
    cell: (branch) => (
      <ConclusionIcon conclusion={branch.latestConclusion} className="size-4" />
    ),
  },
  {
    header: "Latest Run",
    cell: (branch) => (
      <Link
        to="/runs/$traceId"
        params={{ traceId: branch.latestTraceId }}
        className="font-mono text-xs hover:underline"
      >
        {branch.latestRunId}
      </Link>
    ),
  },
  {
    header: "Runs",
    cell: (branch) => (
      <span className="font-mono text-xs">{branch.totalRuns}</span>
    ),
  },
  {
    header: "Success Rate",
    cell: (branch) => (
      <Badge variant={getSuccessRateVariant(branch.successRate)}>
        {branch.successRate}%
      </Badge>
    ),
  },
  {
    header: "Last Activity",
    cell: (branch) => (
      <span className="text-xs text-muted-foreground">
        {formatRelativeTime(branch.latestTimestamp)}
      </span>
    ),
  },
];

export function ActiveBranchesTable({ data }: ActiveBranchesTableProps) {
  return (
    <DataTable
      data={data}
      columns={columns}
      rowKey={(branch) => branch.branch}
      emptyState={
        <Empty>
          <EmptyDescription>No active branches found</EmptyDescription>
        </Empty>
      }
    />
  );
}
