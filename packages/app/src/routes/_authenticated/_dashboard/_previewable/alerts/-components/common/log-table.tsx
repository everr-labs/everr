import { type Column, DataTable } from "@everr/ui/components/data-table";

export const ALERTING_LOG_CELL = "px-3 py-0";
export const ALERTING_LOG_CELL_NUMERIC =
  "whitespace-nowrap px-3 py-0 font-mono tabular-nums";

/**
 * The scrolling event-log table shared by the rule history tabs: sticky muted
 * header, dense rows, and one empty-state convention.
 */
export function AlertingLogTable<T>({
  data,
  columns,
  rowKey,
  emptyLabel,
}: {
  data: T[];
  columns: Column<T>[];
  rowKey: (row: T, index: number) => string;
  emptyLabel: string;
}) {
  return (
    <DataTable
      data={data}
      columns={columns.map((column) => ({
        ...column,
        className: column.className ?? "px-3 py-2 font-medium",
        cellClassName: column.cellClassName ?? ALERTING_LOG_CELL,
      }))}
      rowKey={rowKey}
      rowClassName={() => "h-8 border-b border-border/60 hover:bg-muted/30"}
      stickyHeader
      containerClassName="max-h-[28rem] overflow-auto overscroll-contain border-t border-border/60 [&_table]:min-w-[42rem] [&_table]:text-xs [&_thead]:bg-muted [&_thead]:text-muted-foreground"
      emptyState={
        <div className="border-t border-border/60 px-3 py-8 text-center text-xs text-muted-foreground">
          {emptyLabel}
        </div>
      }
    />
  );
}
