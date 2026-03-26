import { Badge } from "@everr/ui/components/badge";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Empty, EmptyDescription } from "@everr/ui/components/empty";
import type { TopFailingJob } from "@/data/repo-detail/schemas";

interface TopFailingJobsTableProps {
  data: TopFailingJob[];
}

const columns: Column<TopFailingJob>[] = [
  {
    header: "Job",
    cell: (job) => <span className="font-medium">{job.jobName}</span>,
  },
  {
    header: "Workflow",
    cell: (job) => (
      <span className="text-muted-foreground">{job.workflowName}</span>
    ),
  },
  {
    header: "Failures",
    cell: (job) => <Badge variant="destructive">{job.failureCount}</Badge>,
  },
  {
    header: "Total Runs",
    cell: (job) => <span className="font-mono text-xs">{job.totalRuns}</span>,
  },
  {
    header: "Failure Rate",
    cell: (job) => (
      <span className="font-mono text-xs text-red-600">{job.failureRate}%</span>
    ),
  },
];

export function TopFailingJobsTable({ data }: TopFailingJobsTableProps) {
  return (
    <DataTable
      data={data}
      columns={columns}
      rowKey={(job) => job.jobName}
      emptyState={
        <Empty>
          <EmptyDescription>No failing jobs found</EmptyDescription>
        </Empty>
      }
    />
  );
}
