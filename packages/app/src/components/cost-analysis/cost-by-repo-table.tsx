import { Badge } from "@everr/ui/components/badge";
import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Empty, EmptyDescription } from "@everr/ui/components/empty";
import type { CostByRepo } from "@/data/cost-analysis/schemas";
import { formatCost } from "@/lib/runner-pricing";

interface CostByRepoTableProps {
  data: CostByRepo[];
}

const columns: Column<CostByRepo>[] = [
  {
    header: "Repository",
    cell: (row) => <span className="">{row.repo}</span>,
  },
  {
    header: "Jobs",
    cell: (row) => row.totalJobs.toLocaleString(),
    className: "pb-2 pr-4",
  },
  {
    header: "Minutes",
    cell: (row) => Math.round(row.totalMinutes).toLocaleString(),
    className: "pb-2 pr-4",
  },
  {
    header: "Billing Minutes",
    cell: (row) => row.billingMinutes.toLocaleString(),
    className: "pb-2 pr-4",
  },
  {
    header: "Est. Cost",
    cell: (row) => (
      <span className="font-mono  tabular-nums">
        {formatCost(row.estimatedCost)}
      </span>
    ),
    className: "pb-2 pr-4",
  },
  {
    header: "Top Runner",
    cell: (row) => <Badge variant="outline">{row.topRunner}</Badge>,
  },
];

export function CostByRepoTable({ data }: CostByRepoTableProps) {
  return (
    <DataTable
      data={data}
      columns={columns}
      rowKey={(row) => row.repo}
      emptyState={
        <Empty>
          <EmptyDescription>No repository cost data available</EmptyDescription>
        </Empty>
      }
    />
  );
}
