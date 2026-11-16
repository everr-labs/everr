import { ScrollArea } from "@everr/ui/components/scroll-area";
import { cn } from "@everr/ui/lib/utils";
import { type AnimationEvent, type MouseEvent, type ReactNode, useState } from "react";

export interface Column<T> {
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  cellClassName?: string;
  /** `end` right-aligns header and cells, so numbers line up by place value. */
  align?: "start" | "end";
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  rowKey: (row: T, index: number) => string;
  rowClassName?: (row: T, index: number) => string | undefined;
  emptyState?: ReactNode;
  stickyHeader?: boolean;
  bordered?: boolean;
  /**
   * Whether the table brings its own scroll box. Turn it off when the caller
   * already owns one: nesting two viewports leaves the inner one unable to
   * overflow and doubles the tab stops.
   */
  scrollable?: boolean;
  containerClassName?: string;
  /**
   * Makes rows clickable (mouse convenience). Keep a real link inside a cell as
   * the keyboard/screen-reader target; this handler should no-op when the click
   * originates on that link so it doesn't double-navigate.
   */
  onRowClick?: (row: T, event: MouseEvent) => void;
  /**
   * Rows added after the first render fade and grow in; removed rows fade and
   * collapse out, so the eye sees where they went. For tables that change by
   * the reader's own actions, not ones that refresh on a timer.
   */
  animateRows?: boolean;
}

type RowPhase = "idle" | "enter" | "exit";
interface RowEntry<T> {
  key: string;
  row: T;
  phase: RowPhase;
}

/**
 * The rows to render: the current data, plus rows that just left and are
 * still animating out, kept at the position they left from.
 */
function reconcileRows<T>(
  data: T[],
  previous: RowEntry<T>[],
  rowKey: (row: T, index: number) => string,
): RowEntry<T>[] {
  const before = new Map(previous.map((entry) => [entry.key, entry]));
  const next: RowEntry<T>[] = data.map((row, index) => {
    const key = rowKey(row, index);
    const old = before.get(key);
    const phase: RowPhase = old && old.phase !== "exit" ? old.phase : "enter";
    return { key, row, phase };
  });
  const present = new Set(next.map((entry) => entry.key));
  previous.forEach((entry, index) => {
    if (!present.has(entry.key)) {
      next.splice(Math.min(index, next.length), 0, { ...entry, phase: "exit" });
    }
  });
  return next;
}

/* `animateRows`: a row cannot animate its height, so each cell's content
   sits in a grid track that goes between 0fr and 1fr while the cell's own
   vertical padding follows. Exit is quicker than entry. With reduced motion
   the animations still run, for 1ms, because an exiting row is removed when
   its animation ends. */
const rowCell = cn(
  "in-data-[row-phase=enter]:animate-row-enter in-data-[row-phase=exit]:animate-row-exit",
  "motion-reduce:[animation-duration:1ms]",
);
const rowCellTrack = cn(
  "grid grid-rows-[1fr] *:min-h-0 *:overflow-hidden",
  "in-data-[row-phase=enter]:animate-cell-grow in-data-[row-phase=exit]:animate-cell-shrink",
  "motion-reduce:[animation-duration:1ms]",
);

export function DataTable<T>({
  data,
  columns,
  rowKey,
  rowClassName,
  emptyState,
  stickyHeader,
  bordered,
  scrollable = true,
  containerClassName,
  onRowClick,
  animateRows = false,
}: DataTableProps<T>) {
  // Derived during render, not in an effect: when `data` changes, the rows
  // that left are kept (marked "exit") until their animation ends.
  const [seenData, setSeenData] = useState(data);
  const [entries, setEntries] = useState<RowEntry<T>[]>(() =>
    data.map((row, index) => ({ key: rowKey(row, index), row, phase: "idle" })),
  );
  if (animateRows && data !== seenData) {
    setSeenData(data);
    setEntries(reconcileRows(data, entries, rowKey));
  }
  const rows: RowEntry<T>[] = animateRows
    ? entries
    : data.map((row, index) => ({ key: rowKey(row, index), row, phase: "idle" }));

  const handleRowAnimationEnd = (key: string) => (event: AnimationEvent) => {
    if (event.animationName !== "data-table-row-exit") return;
    setEntries((current) => current.filter((e) => !(e.key === key && e.phase === "exit")));
  };

  if (rows.length === 0 && emptyState) {
    // oxlint-disable-next-line react/jsx-no-useless-fragment -- Preserve the existing fragment boundary for the caller-provided empty state.
    return <>{emptyState}</>;
  }

  const isFirst = (i: number) => i === 0;
  const isLast = (i: number) => i === columns.length - 1;

  const table = (
    <table className={cn("w-full text-sm", bordered && "border-separate border-spacing-0")}>
      <thead className={cn(stickyHeader && "sticky top-0 z-10 bg-card")}>
        <tr className="text-left text-muted-foreground">
          {columns.map((col, i) => (
            <th
              // oxlint-disable-next-line react/no-array-index-key -- Columns have a fixed order for this table; row identity is supplied separately by rowKey.
              key={i}
              className={cn(
                "whitespace-nowrap",
                col.align === "end" && "text-right",
                col.className ??
                  (bordered
                    ? "border-b border-border px-3 py-2 font-medium"
                    : cn("pb-2", !isLast(i) && "pr-4", isFirst(i) && "pl-3", isLast(i) && "pr-3")),
              )}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className={bordered ? "[&>tr:last-child>td]:border-b-0" : ""}>
        {rows.map(({ key, row, phase }, rowIndex) => (
          <tr
            key={key}
            data-row-phase={phase === "idle" ? undefined : phase}
            aria-hidden={phase === "exit" || undefined}
            onAnimationEnd={phase === "exit" ? handleRowAnimationEnd(key) : undefined}
            onClick={onRowClick && phase !== "exit" ? (event) => onRowClick(row, event) : undefined}
            className={cn(
              "hover:bg-muted/50",
              phase === "exit" && "pointer-events-none",
              onRowClick && "cursor-pointer active:bg-muted",
              !bordered && "border-b last:border-0",
              rowClassName?.(row, rowIndex),
            )}
          >
            {columns.map((col, i) => (
              <td
                // oxlint-disable-next-line react/no-array-index-key -- Columns have a fixed order for this table; row identity is supplied separately by rowKey.
                key={i}
                className={cn(
                  animateRows && rowCell,
                  col.align === "end" && "text-right",
                  col.cellClassName ??
                    (bordered
                      ? "border-b border-border px-3 py-2"
                      : cn(
                          "py-2",
                          !isLast(i) && "pr-4",
                          isFirst(i) && "pl-3",
                          isLast(i) && "pr-3",
                        )),
                )}
              >
                {animateRows ? (
                  // Two wrappers so the cell can collapse to zero height:
                  // a grid track animates from 1fr to 0fr, a table row cannot.
                  <div className={rowCellTrack}>
                    <div>{col.cell(row)}</div>
                  </div>
                ) : (
                  col.cell(row)
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (!scrollable) {
    return <div className={containerClassName}>{table}</div>;
  }

  // Both axes: a table overflows sideways on narrow panes as readily as it
  // does downwards, and a missing scrollbar on either would be silent.
  return (
    <ScrollArea className={containerClassName} orientation="both">
      {table}
    </ScrollArea>
  );
}
