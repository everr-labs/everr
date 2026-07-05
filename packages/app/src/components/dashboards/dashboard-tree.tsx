import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  LayoutDashboard,
  NotebookText,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { PreviewStatusBadge } from "@/components/preview-status-badge";
import {
  buildTree,
  type DashboardSummary,
  type FolderNode,
  searchItems,
} from "@/data/dashboards/tree";

type TreeResource = "dashboard" | "runbook";

interface DashboardTreeProps {
  dashboards: DashboardSummary[];
  search: string;
  /** Which resource the rows link to; defaults to dashboards. */
  resource?: TreeResource;
}

export function DashboardTree({
  dashboards,
  search,
  resource = "dashboard",
}: DashboardTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const tree = useMemo(() => buildTree(dashboards), [dashboards]);

  const searching = search.trim().length > 0;
  const results = useMemo(
    () => (searching ? searchItems(dashboards, search) : null),
    [searching, dashboards, search],
  );

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col">
      {results ? (
        <>
          {results.dashboards.map(({ dashboard, path }) => (
            <DashboardRow
              key={`${dashboard.project}/${dashboard.slug}`}
              dashboard={dashboard}
              depth={0}
              path={path}
              resource={resource}
            />
          ))}
          {results.dashboards.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No {resource}s match your search
            </p>
          )}
        </>
      ) : (
        <>
          {tree.folders.map((node) => (
            <FolderRows
              key={node.path}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              resource={resource}
            />
          ))}
          {tree.dashboards.map((dashboard) => (
            <DashboardRow
              key={`${dashboard.project}/${dashboard.slug}`}
              dashboard={dashboard}
              depth={0}
              resource={resource}
            />
          ))}
        </>
      )}
    </div>
  );
}

function FolderRows({
  node,
  depth,
  expanded,
  onToggle,
  resource,
}: {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  resource: TreeResource;
}) {
  const isExpanded = expanded.has(node.path);
  return (
    <>
      <div
        className="flex items-center gap-1 rounded-md py-1 pr-1 hover:bg-accent/50"
        style={{ paddingLeft: `${depth * 20 + 4}px` }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
          aria-label={`${isExpanded ? "Collapse" : "Expand"} folder ${node.name}`}
          aria-expanded={isExpanded}
          onClick={() => onToggle(node.path)}
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{node.name}</span>
        </button>
      </div>
      {isExpanded && (
        <>
          {node.subfolders.map((child) => (
            <FolderRows
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              resource={resource}
            />
          ))}
          {node.dashboards.map((dashboard) => (
            <DashboardRow
              key={`${dashboard.project}/${dashboard.slug}`}
              dashboard={dashboard}
              depth={depth + 1}
              resource={resource}
            />
          ))}
        </>
      )}
    </>
  );
}

function DashboardRow({
  dashboard,
  depth,
  path,
  resource,
}: {
  dashboard: DashboardSummary;
  depth: number;
  path?: string;
  resource: TreeResource;
}) {
  const Icon = resource === "runbook" ? NotebookText : LayoutDashboard;
  const removed = dashboard.previewStatus === "removed";
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-md py-1 pr-1 hover:bg-accent/50",
        removed && "opacity-50",
      )}
      style={{ paddingLeft: `${depth * 20 + 26}px` }}
    >
      <Link
        to={
          resource === "runbook"
            ? "/runbooks/$project/$slug"
            : "/dashboards/$project/$slug"
        }
        params={{ project: dashboard.project, slug: dashboard.slug }}
        className="flex min-w-0 flex-1 items-center gap-2 py-0.5"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm">{dashboard.name}</span>
        {path && (
          <span className="truncate text-xs text-muted-foreground">{path}</span>
        )}
        <PreviewStatusBadge status={dashboard.previewStatus} />
      </Link>
    </div>
  );
}
