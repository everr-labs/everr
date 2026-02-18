import { Link } from "@tanstack/react-router";
import { ChevronRight, FlaskConical, FolderOpen } from "lucide-react";
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
      className: "pb-1 pr-3 font-medium",
      cellClassName: "py-1 pr-3",
      cell: (row) => {
        const Icon = row.isSuite ? FolderOpen : FlaskConical;
        const search = buildChildSearch(row.name, pkg);
        const displayName = pkg ? testNameLastSegment(row.name) : row.name;
        return (
          <Link
            to="/dashboard/test-performance"
            search={search}
            className="group -mx-1 flex items-center justify-between rounded px-1 py-0.5 font-mono text-[11px] hover:bg-muted/60"
          >
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Icon className="text-muted-foreground size-3 shrink-0" />
              <span className="truncate">{displayName}</span>
            </span>
            <ChevronRight className="text-muted-foreground size-3 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
          </Link>
        );
      },
    },
    {
      header: "Executions",
      className: "pb-1 pr-3 font-medium",
      cellClassName: "py-1 pr-3",
      cell: (row) => (
        <span className="tabular-nums text-xs">
          {row.executions.toLocaleString()}
        </span>
      ),
    },
    {
      header: "Avg Duration",
      className: "pb-1 pr-3 font-medium",
      cellClassName: "py-1 pr-3",
      cell: (row) => (
        <span className="tabular-nums text-xs">
          {formatDurationCompact(row.avgDuration, "s")}
        </span>
      ),
    },
    {
      header: "P95 Duration",
      className: "pb-1 pr-3 font-medium",
      cellClassName: "py-1 pr-3",
      cell: (row) => (
        <span className="tabular-nums text-xs">
          {formatDurationCompact(row.p95Duration, "s")}
        </span>
      ),
    },
    {
      header: "Failure Rate",
      className: "pb-1 font-medium",
      cellClassName: "py-1",
      cell: (row) => (
        <span className="tabular-nums text-xs">{row.failureRate}%</span>
      ),
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
