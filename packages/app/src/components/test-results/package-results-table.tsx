import { useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { type Column, DataTable } from "@/components/ui/data-table";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { SortableColumnHeader } from "@/components/ui/sortable-column-header";
import type { PackageResult } from "@/data/test-results";
import { useSortableData } from "@/hooks/use-sortable-data";
import { formatDuration, getSuccessRateVariant } from "@/lib/formatting";

interface PackageResultsTableProps {
  data: PackageResult[];
}

type SortField = "passRate" | "failCount" | "testCount" | "avgDuration";

export function PackageResultsTable({ data }: PackageResultsTableProps) {
  const comparator = useCallback(
    (a: PackageResult, b: PackageResult, field: SortField) => {
      switch (field) {
        case "passRate":
          return a.passRate - b.passRate;
        case "failCount":
          return a.failCount - b.failCount;
        case "testCount":
          return a.testCount - b.testCount;
        case "avgDuration":
          return a.avgDuration - b.avgDuration;
        default:
          return 0;
      }
    },
    [],
  );

  const { sorted, toggleSort } = useSortableData<PackageResult, SortField>(
    data,
    "failCount",
    comparator,
  );

  const columns: Column<PackageResult>[] = [
    {
      header: "Package",
      cell: (pkg) => (
        <span className="font-medium">{pkg.testPackage || "(default)"}</span>
      ),
    },
    {
      header: "Repository",
      cell: (pkg) => (
        <span className="text-muted-foreground text-xs">{pkg.repo}</span>
      ),
    },
    {
      header: (
        <SortableColumnHeader
          label="Tests"
          onClick={() => toggleSort("testCount")}
        />
      ),
      cell: (pkg) => <span className="font-mono text-xs">{pkg.testCount}</span>,
    },
    {
      header: "Pass / Fail / Skip",
      cell: (pkg) => (
        <div className="flex items-center gap-1">
          <Badge
            variant="outline"
            className="text-[10px] px-1 py-0 text-green-600"
          >
            {pkg.passCount}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] px-1 py-0 text-red-600"
          >
            {pkg.failCount}
          </Badge>
          <Badge
            variant="outline"
            className="text-[10px] px-1 py-0 text-muted-foreground"
          >
            {pkg.skipCount}
          </Badge>
        </div>
      ),
    },
    {
      header: (
        <SortableColumnHeader
          label="Pass Rate"
          onClick={() => toggleSort("passRate")}
        />
      ),
      cell: (pkg) => (
        <Badge
          variant={getSuccessRateVariant(pkg.passRate, {
            good: 90,
            fair: 70,
          })}
        >
          {pkg.passRate}%
        </Badge>
      ),
    },
    {
      header: (
        <SortableColumnHeader
          label="Avg Duration"
          onClick={() => toggleSort("avgDuration")}
        />
      ),
      cell: (pkg) => (
        <span className="font-mono text-xs">
          {formatDuration(pkg.avgDuration)}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      data={sorted}
      columns={columns}
      rowKey={(pkg) => `${pkg.repo}:${pkg.testPackage}`}
      emptyState={
        <Empty>
          <EmptyDescription>No test packages found</EmptyDescription>
        </Empty>
      }
    />
  );
}
