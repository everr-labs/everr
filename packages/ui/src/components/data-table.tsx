import { cn } from "@everr/ui/lib/utils";
import type { MouseEvent, ReactNode } from "react";

export interface Column<T> {
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  cellClassName?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  rowKey: (row: T, index: number) => string;
  rowClassName?: (row: T, index: number) => string | undefined;
  emptyState?: ReactNode;
  stickyHeader?: boolean;
  bordered?: boolean;
  containerClassName?: string;
  /**
   * Makes rows clickable (mouse convenience). Keep a real link inside a cell as
   * the keyboard/screen-reader target; this handler should no-op when the click
   * originates on that link so it doesn't double-navigate.
   */
  onRowClick?: (row: T, event: MouseEvent) => void;
}

export function DataTable<T>({
  data,
  columns,
  rowKey,
  rowClassName,
  emptyState,
  stickyHeader,
  bordered,
  containerClassName,
  onRowClick,
}: DataTableProps<T>) {
  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  const isFirst = (i: number) => i === 0;
  const isLast = (i: number) => i === columns.length - 1;

  return (
    <div className={cn(!bordered && "overflow-x-auto", containerClassName)}>
      <table className={cn("w-full text-sm", bordered && "border-separate border-spacing-0")}>
        <thead className={cn(stickyHeader && "sticky top-0 z-10 bg-card")}>
          <tr className="text-left text-muted-foreground">
            {columns.map((col, i) => (
              <th
                key={i}
                className={cn(
                  "whitespace-nowrap",
                  col.className ??
                    (bordered
                      ? "border-b border-r border-border px-3 py-2 font-medium last:border-r-0"
                      : cn(
                          "pb-2",
                          !isLast(i) && "pr-4",
                          isFirst(i) && "pl-3",
                          isLast(i) && "pr-3",
                        )),
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={bordered ? "[&>tr:last-child>td]:border-b-0" : ""}>
          {data.map((row, rowIndex) => (
            <tr
              key={rowKey(row, rowIndex)}
              onClick={onRowClick ? (event) => onRowClick(row, event) : undefined}
              className={cn(
                "hover:bg-muted/50",
                !bordered && "border-b last:border-0",
                rowClassName?.(row, rowIndex),
              )}
            >
              {columns.map((col, i) => (
                <td
                  key={i}
                  className={
                    col.cellClassName ??
                    (bordered
                      ? "border-b border-r border-border px-3 py-2 last:border-r-0"
                      : cn("py-2", !isLast(i) && "pr-4", isFirst(i) && "pl-3", isLast(i) && "pr-3"))
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
