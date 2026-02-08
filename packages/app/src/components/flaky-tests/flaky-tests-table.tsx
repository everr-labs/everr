import { Link } from "@tanstack/react-router";
import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { SortableColumnHeader } from "@/components/ui/sortable-column-header";
import type { FlakyTest } from "@/data/flaky-tests";
import { useSortableData } from "@/hooks/use-sortable-data";
import {
  formatDuration,
  formatRelativeTime,
  getFailureRateColor,
} from "@/lib/formatting";
import { cn } from "@/lib/utils";

interface FlakyTestsTableProps {
  data: FlakyTest[];
}

type SortField = "failureRate" | "totalExecutions" | "lastSeen" | "avgDuration";

export function FlakyTestsTable({ data }: FlakyTestsTableProps) {
  const comparator = useCallback(
    (a: FlakyTest, b: FlakyTest, field: SortField) => {
      switch (field) {
        case "failureRate":
          return a.failureRate - b.failureRate;
        case "totalExecutions":
          return a.totalExecutions - b.totalExecutions;
        case "lastSeen":
          return (
            new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime()
          );
        case "avgDuration":
          return a.avgDuration - b.avgDuration;
        default:
          return 0;
      }
    },
    [],
  );

  const { sorted, toggleSort } = useSortableData<FlakyTest, SortField>(
    data,
    "failureRate",
    comparator,
  );

  const columns: Column<FlakyTest>[] = [
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
          label="Failure Rate"
          onClick={() => toggleSort("failureRate")}
        />
      ),
      cell: (test) => (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "font-mono font-medium",
              getFailureRateColor(test.failureRate),
            )}
          >
            {test.failureRate}%
          </span>
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {test.failCount}F / {test.passCount}P
          </Badge>
        </div>
      ),
    },
    {
      header: (
        <SortableColumnHeader
          label="Executions"
          onClick={() => toggleSort("totalExecutions")}
        />
      ),
      cell: (test) => (
        <span className="font-mono text-xs">
          {test.totalExecutions}
          <span className="text-muted-foreground ml-1">
            ({test.distinctRuns} runs)
          </span>
        </span>
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
          label="Last Seen"
          onClick={() => toggleSort("lastSeen")}
        />
      ),
      cell: (test) => (
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(test.lastSeen)}
        </span>
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
          <EmptyDescription>
            No flaky tests detected in this time range
          </EmptyDescription>
        </Empty>
      }
    />
  );
}
