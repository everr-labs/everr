import { Link } from "@tanstack/react-router";
import { useCallback } from "react";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { SortableColumnHeader } from "@/components/ui/sortable-column-header";
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

  const columns: Column<SlowestTest>[] = [
    {
      header: "Test",
      cell: (test) => (
        <Link
          to="/dashboard/flaky-tests/detail"
          search={{
            repo: test.repo,
            test: test.testFullName,
            timeRange: "30d",
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
      cell: (test) => (
        <span className="font-mono text-xs">
          {formatDuration(test.avgDuration)}
        </span>
      ),
    },
    {
      header: (
        <SortableColumnHeader
          label="Max Duration"
          onClick={() => toggleSort("maxDuration")}
        />
      ),
      cell: (test) => (
        <span className="font-mono text-xs">
          {formatDuration(test.maxDuration)}
        </span>
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
