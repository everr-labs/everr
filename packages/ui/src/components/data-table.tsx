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
}

export function DataTable<T>({
  data,
  columns,
  rowKey,
  emptyState,
}: DataTableProps<T>) {
  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            {columns.map((col, i) => (
              <th
                key={i}
                className={
                  col.className ??
                  (i < columns.length - 1
                    ? "pb-2 pr-4 font-medium"
                    : "pb-2 font-medium")
                }
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b last:border-0 hover:bg-muted/50"
            >
              {columns.map((col, i) => (
                <td
                  key={i}
                  className={
                    col.cellClassName ??
                    (i < columns.length - 1 ? "py-2 pr-4" : "py-2")
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
