import { Badge } from "@/components/ui/badge";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import type { TopFailingJob } from "@/data/repo-detail";

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
