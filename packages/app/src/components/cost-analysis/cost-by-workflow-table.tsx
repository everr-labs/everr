import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Empty, EmptyDescription } from "@everr/ui/components/empty";
import { WorkflowLink } from "@/components/workflow-link";
import type { CostByWorkflow } from "@/data/cost-analysis/schemas";
import { formatCost } from "@/lib/runner-pricing";

interface CostByWorkflowTableProps {
  data: CostByWorkflow[];
}

const columns: Column<CostByWorkflow>[] = [
  {
    header: "Repository",
    cell: (row) => <span className="text-muted-foreground">{row.repo}</span>,
  },
  {
    header: "Workflow",
    cell: (row) => <WorkflowLink repo={row.repo} workflowName={row.workflow} />,
  },
  {
    header: "Jobs",
    cell: (row) => row.totalJobs.toLocaleString(),
    className: "pb-2 pr-4 font-medium",
  },
  {
    header: "Minutes",
    cell: (row) => Math.round(row.totalMinutes).toLocaleString(),
    className: "pb-2 pr-4 font-medium",
  },
  {
    header: "Est. Cost",
    cell: (row) => (
      <span className="font-mono font-medium tabular-nums">
        {formatCost(row.estimatedCost)}
      </span>
    ),
    className: "pb-2 pr-4 font-medium",
  },
  {
    header: "Avg $/Run",
    cell: (row) => (
      <span className="font-mono font-medium tabular-nums">
        {formatCost(row.avgCostPerRun)}
      </span>
    ),
    className: "pb-2 font-medium",
  },
];

export function CostByWorkflowTable({ data }: CostByWorkflowTableProps) {
  return (
    <DataTable
      data={data}
      columns={columns}
      rowKey={(row) => `${row.repo}:${row.workflow}`}
      emptyState={
        <Empty>
          <EmptyDescription>No workflow cost data available</EmptyDescription>
        </Empty>
      }
    />
  );
}
