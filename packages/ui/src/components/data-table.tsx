import { cn } from "@everr/ui/lib/utils";
import type { ReactNode } from "react";

export interface Column<T> {
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  cellClassName?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  emptyState?: ReactNode;
  stickyHeader?: boolean;
}

export function DataTable<T>({
  data,
  columns,
  rowKey,
  emptyState,
  stickyHeader,
}: DataTableProps<T>) {
  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className={cn(stickyHeader && "sticky top-0 z-10 bg-card")}>
          <tr className="text-left text-muted-foreground">
            {columns.map((col, i) => (
              <th
                key={i}
                className={cn(
                  "whitespace-nowrap",
                  col.className ??
                    cn(
                      "border-b border-r border-border px-3 py-2 font-medium last:border-r-0",
                    ),
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0">
          {data.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-muted/50">
              {columns.map((col, i) => (
                <td
                  key={i}
                  className={
                    col.cellClassName ??
                    cn(
                      "border-b border-r border-border px-3 py-2 last:border-r-0",
                    )
                  }
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
