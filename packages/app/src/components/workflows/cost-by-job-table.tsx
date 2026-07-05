import { type Column, DataTable } from "@everr/ui/components/data-table";
import { Empty, EmptyDescription } from "@everr/ui/components/empty";
import { useMemo } from "react";
import type { WorkflowCostByJob } from "@/data/workflows/schemas";
import { formatCost } from "@/lib/runner-pricing";

interface CostByJobTableProps {
  data: WorkflowCostByJob[];
}

/**
 * Truncates the middle so the distinguishing tail of a job name survives —
 * matrix variants like "…(macOS arm64)" vs "…(macOS x64)" stay legible where a
 * plain end-ellipsis would collapse them to identical rows.
 */
function MiddleTruncate({ text, tail = 12 }: { text: string; tail?: number }) {
  if (text.length <= tail + 6) {
    return (
      <span className="block truncate font-medium" title={text}>
        {text}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 font-medium" title={text}>
      <span className="truncate">{text.slice(0, text.length - tail)}</span>
      <span className="whitespace-pre">{text.slice(text.length - tail)}</span>
    </span>
  );
}

function ShareBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
        {Math.round(pct)}%
      </span>
    </div>
  );
}

export function CostByJobTable({ data }: CostByJobTableProps) {
  const { rows, maxCost } = useMemo(() => {
    const top = data.slice(0, 20);
    return {
      rows: top,
      maxCost: top.reduce((m, r) => Math.max(m, r.estimatedCost), 0),
    };
  }, [data]);

  const columns = useMemo<Column<WorkflowCostByJob>[]>(
    () => [
      {
        header: "Job",
        className: "pb-2 pl-3 pr-4 w-full",
        cellClassName: "py-2 pl-3 pr-4 w-full max-w-0",
        cell: (row) => <MiddleTruncate text={row.job} />,
      },
      {
        header: "Compute",
        className: "pb-2 pr-4 text-right whitespace-nowrap",
        cellClassName: "py-2 pr-4 text-right tabular-nums whitespace-nowrap",
        cell: (row) => `${Math.round(row.computeMinutes).toLocaleString()} min`,
      },
      {
        header: "Billed",
        className: "pb-2 pr-4 text-right whitespace-nowrap",
        cellClassName: "py-2 pr-4 text-right tabular-nums whitespace-nowrap",
        cell: (row) => `${row.billedMinutes.toLocaleString()} min`,
      },
      {
        header: "Est. Cost",
        className: "pb-2 pr-4 text-right whitespace-nowrap",
        cellClassName: "py-2 pr-4 text-right font-mono font-medium tabular-nums whitespace-nowrap",
        cell: (row) => formatCost(row.estimatedCost),
      },
      {
        header: "Share",
        className: "pb-2 pr-3 whitespace-nowrap",
        cellClassName: "py-2 pr-3 whitespace-nowrap",
        cell: (row) => <ShareBar value={row.estimatedCost} max={maxCost} />,
      },
    ],
    [maxCost],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      rowKey={(row) => row.job}
      emptyState={
        <Empty>
          <EmptyDescription>No job cost data in this range</EmptyDescription>
        </Empty>
      }
    />
  );
}
