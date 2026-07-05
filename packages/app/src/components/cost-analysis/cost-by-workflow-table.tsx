import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Empty, EmptyDescription } from "@everr/ui/components/empty";
import { useNavigate } from "@tanstack/react-router";
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
    cell: (row) => (
      // Real anchor: the keyboard/screen-reader target. The whole row is also
      // clickable (mouse) via onRowClick below; both open the cost detail.
      <WorkflowLink
        repo={row.repo}
        workflowName={row.workflow}
        className="rounded-sm group-hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    ),
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
      <span className="font-mono font-medium tabular-nums">{formatCost(row.estimatedCost)}</span>
    ),
    className: "pb-2 pr-4 font-medium",
  },
  {
    header: "Avg $/Run",
    cell: (row) => (
      <span className="font-mono font-medium tabular-nums">{formatCost(row.avgCostPerRun)}</span>
    ),
    className: "pb-2 font-medium",
  },
];

export function CostByWorkflowTable({ data }: CostByWorkflowTableProps) {
  const navigate = useNavigate();

  return (
    <DataTable
      data={data}
      columns={columns}
      rowKey={(row) => `${row.repo}:${row.workflow}`}
      rowClassName={() => "group cursor-pointer"}
      onRowClick={(row, event) => {
        // The workflow-name anchor handles its own click + keyboard activation.
        if (event.target instanceof Element && event.target.closest("a")) return;
        // Time range carries via the dashboard's retainSearchParams.
        void navigate({
          to: "/workflows/$repo/$workflowName",
          params: { repo: row.repo, workflowName: row.workflow },
        });
      }}
      emptyState={
        <Empty>
          <EmptyDescription>No workflow cost data available</EmptyDescription>
        </Empty>
      }
    />
  );
}
