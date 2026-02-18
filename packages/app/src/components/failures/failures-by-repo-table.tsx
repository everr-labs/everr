import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import type { FailureByRepo } from "@/data/failures";

interface FailuresByRepoTableProps {
  data: FailureByRepo[];
}

const columns: Column<FailureByRepo>[] = [
  {
    header: "Repository",
    cell: (row) => (
      <Link
        to="/dashboard/repos"
        search={{ name: row.repo }}
        className="font-medium hover:underline"
      >
        {row.repo}
      </Link>
    ),
  },
  {
    header: "Failures",
    cell: (row) => <Badge variant="destructive">{row.failureCount}</Badge>,
  },
  {
    header: "Top Pattern",
    cell: (row) => (
      <div
        className="max-w-md truncate font-mono text-xs text-muted-foreground"
        title={row.topPattern}
      >
        {row.topPattern || "—"}
      </div>
    ),
  },
];

export function FailuresByRepoTable({ data }: FailuresByRepoTableProps) {
  return (
    <DataTable
      data={data}
      columns={columns}
      rowKey={(row) => row.repo}
      emptyState={
        <Empty>
          <EmptyDescription>No failures found</EmptyDescription>
        </Empty>
      }
    />
  );
}
