import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  FlaskConical,
  FolderOpen,
  Package,
} from "lucide-react";
import { useMemo, useState } from "react";
import { type Column, DataTable } from "@/components/ui/data-table";
import type { TestPerfChild } from "@/data/test-performance";
import { formatDurationCompact, testNameLastSegment } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import {
  getTestPerfHierarchyKind,
  getTestPerfHierarchyKindLabel,
} from "./hierarchy-kind";

interface ChildrenTableProps {
  data: TestPerfChild[];
  pkg?: string;
  repo?: string;
  branch?: string;
  timeRange: { from: string; to: string };
  fetchChildren?: (scope: {
    pkg?: string;
    path?: string;
  }) => Promise<TestPerfChild[]>;
}

interface TreeRow {
  key: string;
  row: TestPerfChild;
  depth: number;
  scopePkg?: string;
}

function keyFor(scopePkg: string | undefined, name: string) {
  return `${scopePkg ?? "__root__"}::${name}`;
}

function buildChildSearch(childName: string, scopePkg?: string) {
  if (!scopePkg) {
    // Root level: child is a package name
    return (prev: Record<string, unknown>) => ({
      ...prev,
      pkg: childName,
      path: undefined,
    });
  }
  // Package or deeper level: child name is already the full path.
  // Always set pkg explicitly so nested rows navigated from root-expanded view
  // still resolve to the correct package scope.
  return (prev: Record<string, unknown>) => ({
    ...prev,
    pkg: scopePkg,
    path: childName,
  });
}

function childScopeFor(row: TreeRow): { pkg?: string; path?: string } {
  if (!row.scopePkg) {
    return { pkg: row.row.name, path: undefined };
  }
  return { pkg: row.scopePkg, path: row.row.name };
}

function isDescendant(
  value: { pkg?: string; path?: string },
  target: { pkg?: string; path?: string },
  targetName: string,
) {
  if (!target.pkg) {
    return value.pkg === targetName;
  }
  if (!target.path) {
    return value.pkg === target.pkg;
  }
  return (
    value.pkg === target.pkg &&
    typeof value.path === "string" &&
    (value.path === targetName || value.path.startsWith(`${targetName} > `))
  );
}

function heatTone(row: TestPerfChild) {
  if (row.failureRate >= 20) {
    return {
      dot: "bg-red-500",
      chip: "bg-red-500/8 text-red-700 dark:text-red-300",
    };
  }
  if (row.failureRate >= 8) {
    return {
      dot: "bg-amber-500",
      chip: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  return {
    dot: "bg-emerald-500/80",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  };
}

function makeColumns(
  expanded: Record<string, { pkg?: string; path?: string }>,
  onToggle: (row: TreeRow) => Promise<void> | void,
): Column<TreeRow>[] {
  return [
    {
      header: "Name",
      className: "pb-1 pl-3 pr-3 font-medium",
      cellClassName: "py-1 pl-3 pr-3",
      cell: (row) => {
        const nodeKind = getTestPerfHierarchyKind(row.row, row.scopePkg);
        const Icon =
          nodeKind === "package"
            ? Package
            : nodeKind === "suite"
              ? FolderOpen
              : FlaskConical;
        const search = buildChildSearch(row.row.name, row.scopePkg);
        const displayName = row.scopePkg
          ? testNameLastSegment(row.row.name)
          : row.row.name;
        const isExpanded = Boolean(expanded[row.key]);
        const nodeKindLabel = getTestPerfHierarchyKindLabel(nodeKind);
        return (
          <div
            className="group -mx-1 flex items-center gap-1 rounded px-1 py-0.5"
            style={{ paddingLeft: `${row.depth * 12 + 4}px` }}
          >
            {row.row.isSuite ? (
              <button
                type="button"
                onClick={() => {
                  void onToggle(row);
                }}
                className="text-muted-foreground hover:text-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
                aria-label={
                  isExpanded
                    ? `Collapse ${nodeKindLabel.toLowerCase()}`
                    : `Expand ${nodeKindLabel.toLowerCase()}`
                }
              >
                {isExpanded ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
              </button>
            ) : (
              <span className="inline-block size-4 shrink-0" />
            )}

            <Link
              to="/dashboard/tests-overview"
              search={search}
              className="flex min-w-0 flex-1 items-center gap-1 rounded"
            >
              <Icon className="text-muted-foreground size-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] hover:underline">
                {displayName}
              </span>
            </Link>
          </div>
        );
      },
    },
    {
      header: "Failure Rate",
      className: "pb-1 pr-3 font-medium",
      cellClassName: "py-1 pr-3",
      cell: (row) => {
        const tone = heatTone(row.row);
        return (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-xs",
              tone.chip,
            )}
          >
            <span className={cn("size-1.5 rounded-full", tone.dot)} />
            <span className="tabular-nums">{row.row.failureRate}%</span>
          </span>
        );
      },
    },
    {
      header: "Avg Duration",
      className: "pb-1 pr-3 font-medium",
      cellClassName: "py-1 pr-3",
      cell: (row) => (
        <span className="tabular-nums text-xs">
          {formatDurationCompact(row.row.avgDuration, "s")}
        </span>
      ),
    },
    {
      header: "P95 Duration",
      className: "pb-1 font-medium",
      cellClassName: "py-1",
      cell: (row) => (
        <span className="tabular-nums text-xs">
          {formatDurationCompact(row.row.p95Duration, "s")}
        </span>
      ),
    },
  ];
}

export function ChildrenTable({
  data,
  pkg,
  repo: _repo,
  branch: _branch,
  timeRange: _timeRange,
  fetchChildren,
}: ChildrenTableProps) {
  const [expanded, setExpanded] = useState<
    Record<string, { pkg?: string; path?: string }>
  >({});
  const [nestedByKey, setNestedByKey] = useState<Map<string, TestPerfChild[]>>(
    () => new Map(),
  );

  const expandedEntries = useMemo(() => Object.entries(expanded), [expanded]);
  const expandedSet = useMemo(
    () => new Set(expandedEntries.map(([key]) => key)),
    [expandedEntries],
  );

  const treeRows = useMemo(() => {
    const out: TreeRow[] = [];

    const walk = (
      rows: TestPerfChild[],
      depth: number,
      currentPkg: string | undefined,
    ) => {
      for (const row of rows) {
        const key = keyFor(currentPkg, row.name);
        const node: TreeRow = { key, row, depth, scopePkg: currentPkg };
        out.push(node);
        if (row.isSuite && expandedSet.has(key)) {
          const children = nestedByKey.get(key) ?? [];
          if (children.length > 0) {
            const nextPkg = currentPkg ?? row.name;
            walk(children, depth + 1, nextPkg);
          }
        }
      }
    };

    walk(data, 0, pkg);
    return out;
  }, [data, expandedSet, nestedByKey, pkg]);

  const onToggle = async (row: TreeRow) => {
    const targetScope = childScopeFor(row);
    const shouldExpand = !expanded[row.key];

    setExpanded((prev) => {
      if (prev[row.key]) {
        const next: Record<string, { pkg?: string; path?: string }> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (k === row.key) {
            continue;
          }
          if (!isDescendant(v, targetScope, row.row.name)) {
            next[k] = v;
          }
        }
        return next;
      }
      return { ...prev, [row.key]: targetScope };
    });

    if (
      shouldExpand &&
      fetchChildren &&
      targetScope.pkg &&
      !nestedByKey.has(row.key)
    ) {
      const children = await fetchChildren(targetScope);
      setNestedByKey((prev) => {
        const next = new Map(prev);
        next.set(row.key, children);
        return next;
      });
    }
  };

  const columns = makeColumns(expanded, onToggle);

  return (
    <DataTable
      data={treeRows}
      columns={columns}
      rowKey={(row) => row.key}
      emptyState={
        <p className="text-muted-foreground py-8 text-center">
          No tests found at this level
        </p>
      }
    />
  );
}
