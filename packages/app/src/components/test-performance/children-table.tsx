import { Link } from "@tanstack/react-router";
import { FlaskConical, FolderOpen } from "lucide-react";
import { type Column, DataTable } from "@/components/ui/data-table";
import type { TestPerfChild } from "@/data/test-performance";
import { formatDurationCompact } from "@/lib/formatting";

interface ChildrenTableProps {
  data: TestPerfChild[];
  suiteNames: Set<string>;
  pkg?: string;
}

type SearchUpdater = (prev: Record<string, unknown>) => Record<string, unknown>;

/** Extract the last segment of a test name for display */
function displayName(fullName: string): string {
  // Vitest uses " > ", Go tests use "/"
  const sep = fullName.includes(" > ") ? " > " : "/";
  return fullName.split(sep).pop() ?? fullName;
}

function buildChildSearch(childName: string, pkg?: string): SearchUpdater {
  if (!pkg) {
    // Root level: child is a package name
    return (prev) => ({ ...prev, pkg: childName, path: undefined });
  }
  // Package or deeper level: child name is already the full path
  return (prev) => ({ ...prev, path: childName });
}

function makeColumns(
  suiteNames: Set<string>,
  pkg?: string,
): Column<TestPerfChild>[] {
  return [
    {
      header: "Name",
      cell: (row) => {
        const isSuite = suiteNames.has(row.name);
        const Icon = isSuite ? FolderOpen : FlaskConical;
        const search = buildChildSearch(row.name, pkg);
        return (
          <Link
            to="/dashboard/test-performance"
            search={search}
            className="inline-flex items-center gap-1.5 font-mono text-xs hover:underline"
          >
            <Icon className="text-muted-foreground size-3.5 shrink-0" />
            {pkg ? displayName(row.name) : row.name}
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

export function ChildrenTable({ data, suiteNames, pkg }: ChildrenTableProps) {
  const columns = makeColumns(suiteNames, pkg);

  return (
    <DataTable
      data={data}
      columns={columns}
      rowKey={(row) => row.name}
      emptyState={
        <p className="text-muted-foreground py-8 text-center">
          No tests found at this level
        </p>
      }
    />
  );
}
