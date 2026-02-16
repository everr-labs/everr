import { Link } from "@tanstack/react-router";
import { FlaskConical, FolderOpen } from "lucide-react";
import { type Column, DataTable } from "@/components/ui/data-table";
import type { TestPerfChild } from "@/data/test-performance";
import { formatDurationCompact, testNameLastSegment } from "@/lib/formatting";

interface ChildrenTableProps {
  data: TestPerfChild[];
  pkg?: string;
}

function buildChildSearch(childName: string, pkg?: string) {
  if (!pkg) {
    // Root level: child is a package name
    return (prev: Record<string, unknown>) => ({
      ...prev,
      pkg: childName,
      path: undefined,
    });
  }
  // Package or deeper level: child name is already the full path
  return (prev: Record<string, unknown>) => ({ ...prev, path: childName });
}

function makeColumns(pkg?: string): Column<TestPerfChild>[] {
  return [
    {
      header: "Name",
      cell: (row) => {
        const Icon = row.isSuite ? FolderOpen : FlaskConical;
        const search = buildChildSearch(row.name, pkg);
        return (
          <Link
            to="/dashboard/test-performance"
            search={search}
            className="inline-flex items-center gap-1.5 font-mono text-xs hover:underline"
          >
            <Icon className="text-muted-foreground size-3.5 shrink-0" />
            {pkg ? testNameLastSegment(row.name) : row.name}
          </Link>
        );
      },
    },
    {
      header: "Executions",
      cell: (row) => (
        <span className="tabular-nums">{row.executions.toLocaleString()}</span>
      ),
    },
    {
      header: "Avg Duration",
      cell: (row) => (
        <span className="tabular-nums">
          {formatDurationCompact(row.avgDuration, "s")}
        </span>
      ),
    },
    {
      header: "P95 Duration",
      cell: (row) => (
        <span className="tabular-nums">
          {formatDurationCompact(row.p95Duration, "s")}
        </span>
      ),
    },
    {
      header: "Failure Rate",
      cell: (row) => <span className="tabular-nums">{row.failureRate}%</span>,
    },
  ];
}

export function ChildrenTable({ data, pkg }: ChildrenTableProps) {
  return (
    <DataTable
      data={data}
      columns={makeColumns(pkg)}
      rowKey={(row) => row.name}
      emptyState={
        <p className="text-muted-foreground py-8 text-center">
          No tests found at this level
        </p>
      }
    />
  );
}
