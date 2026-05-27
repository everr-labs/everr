import { type Column, DataTable } from "@everr/ui/components/data-table";
import { TableIcon } from "lucide-react";
import type { QueryResultRow, VisualizationProps } from "../index";

function buildColumns(rows: QueryResultRow[]): Column<QueryResultRow>[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).map((key) => ({
    header: key,
    cell: (row: QueryResultRow) => {
      const val = row[key];
      if (val == null)
        return <span className="text-muted-foreground">NULL</span>;
      return String(val);
    },
  }));
}

export function TableVisualization({ plugin, data }: VisualizationProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <TableIcon className="size-8" />
        <p className="text-sm">No data — run a query to see results</p>
      </div>
    );
  }

  const columns = buildColumns(data);

  return (
    <div className="flex h-full flex-col border-t border-border">
      <div className="min-h-0 flex-1 overflow-auto overscroll-none">
        <DataTable
          data={data}
          columns={columns}
          rowKey={(_, i) => String(i)}
          stickyHeader={plugin.spec.stickyHeader === true}
          bordered
        />
      </div>
    </div>
  );
}
