import { Link } from "@tanstack/react-router";
import { TrendingDown, TrendingUp } from "lucide-react";
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

type SortField =
  | "failureRate"
  | "totalExecutions"
  | "lastSeen"
  | "avgDuration"
  | "firstSeen";

function isNewFlaky(firstSeen: string): boolean {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return new Date(firstSeen).getTime() > sevenDaysAgo;
}

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
        case "firstSeen":
          return (
            new Date(a.firstSeen).getTime() - new Date(b.firstSeen).getTime()
          );
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
          }}
          className="hover:underline"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium">{test.testFullName}</span>
            {isNewFlaky(test.firstSeen) && (
              <Badge variant="destructive" className="text-[10px] px-1 py-0">
                New
              </Badge>
            )}
          </div>
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
      cell: (test) => {
        const diff = test.recentFailureRate - test.failureRate;
        const showTrend = Math.abs(diff) > 5;
        return (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-mono font-medium",
                getFailureRateColor(test.failureRate),
              )}
            >
              {test.failureRate}%
            </span>
            {showTrend &&
              (diff > 0 ? (
                <TrendingUp className="h-3.5 w-3.5 text-red-500" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-green-500" />
              ))}
            <Badge variant="outline" className="text-[10px] px-1 py-0">
              {test.failCount}F / {test.passCount}P
            </Badge>
          </div>
        );
      },
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
          label="First Seen"
          onClick={() => toggleSort("firstSeen")}
        />
      ),
      cell: (test) => (
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(test.firstSeen)}
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
