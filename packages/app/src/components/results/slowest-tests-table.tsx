import { Link } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { SortableColumnHeader } from "@/components/ui/sortable-column-header";
import { Sparkline } from "@/components/ui/sparkline";
import type { SlowestTest } from "@/data/test-results";
import { useSortableData } from "@/hooks/use-sortable-data";
import { formatDuration } from "@/lib/formatting";

interface SlowestTestsTableProps {
  data: SlowestTest[];
}

type SortField = "avgDuration" | "maxDuration" | "executionCount";

export function SlowestTestsTable({ data }: SlowestTestsTableProps) {
  const comparator = useCallback(
    (a: SlowestTest, b: SlowestTest, field: SortField) => {
      switch (field) {
        case "avgDuration":
          return a.avgDuration - b.avgDuration;
        case "maxDuration":
          return a.maxDuration - b.maxDuration;
        case "executionCount":
          return a.executionCount - b.executionCount;
        default:
          return 0;
      }
    },
    [],
  );

  const { sorted, toggleSort } = useSortableData<SlowestTest, SortField>(
    data,
    "avgDuration",
    comparator,
  );

  const avgDurationMax = useMemo(
    () => Math.max(0, ...data.flatMap((t) => t.avgDurationTrend)),
    [data],
  );

  const maxDurationMax = useMemo(
    () => Math.max(0, ...data.flatMap((t) => t.maxDurationTrend)),
    [data],
  );

  const columns: Column<SlowestTest>[] = [
    {
      header: "Test",
      cell: (test) => (
        <Link
          to="/dashboard/runs"
          search={{
            repo: test.repo,
            conclusion: "failure",
          }}
          className="hover:underline"
        >
          <div className="font-medium">{test.testFullName}</div>
          <div className="text-xs text-muted-foreground">
            {test.testPackage && (
              <span className="mr-2">{test.testPackage}</span>
            )}
            <span>{test.repo}</span>
          </div>
        </Link>
      ),
    },
    {
      header: (
        <SortableColumnHeader
          label="Avg Duration"
          onClick={() => toggleSort("avgDuration")}
        />
      ),
      cellClassName: "h-0 py-0 pr-4",
      cell: (test) => (
        <div className="relative h-full flex items-center">
          <span className="font-mono text-xs relative z-10">
            {formatDuration(test.avgDuration)}
          </span>
          <Sparkline
            data={test.avgDurationTrend}
            color="hsl(217, 91%, 60%)"
            maxValue={avgDurationMax}
            className="absolute inset-0"
          />
        </div>
      ),
    },
    {
      header: (
        <SortableColumnHeader
          label="Max Duration"
          onClick={() => toggleSort("maxDuration")}
        />
      ),
      cellClassName: "h-0 py-0 pr-4",
      cell: (test) => (
        <div className="relative h-full flex items-center">
          <span className="font-mono text-xs relative z-10">
            {formatDuration(test.maxDuration)}
          </span>
          <Sparkline
            data={test.maxDurationTrend}
            color="hsl(0, 84%, 60%)"
            maxValue={maxDurationMax}
            className="absolute inset-0"
          />
        </div>
      ),
    },
    {
      header: (
        <SortableColumnHeader
          label="Executions"
          onClick={() => toggleSort("executionCount")}
        />
      ),
      cell: (test) => (
        <span className="font-mono text-xs">{test.executionCount}</span>
      ),
    },
  ];

  return (
    <DataTable
      data={sorted}
      columns={columns}
      rowKey={(test) => `${test.repo}:${test.testFullName}`}
      emptyState={
        <Empty>
          <EmptyDescription>No test data available</EmptyDescription>
        </Empty>
      }
    />
  );
}
