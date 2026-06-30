import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  LayoutDashboard,
  NotebookText,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  buildTree,
  type DashboardSort,
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
  const [sort, setSort] = useState<DashboardSort>("updated");

  const tree = useMemo(() => buildTree(dashboards, sort), [dashboards, sort]);

  const searching = search.trim().length > 0;
  const results = useMemo(
    () => (searching ? searchItems(dashboards, search, sort) : null),
    [searching, dashboards, search, sort],
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
      <div className="mb-1 flex justify-end">
        <Select value={sort} onValueChange={(v) => setSort(v as DashboardSort)}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Recently updated</SelectItem>
            <SelectItem value="name">Name</SelectItem>
          </SelectContent>
        </Select>
      </div>
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
          <span className="ml-1 shrink-0 text-xs text-muted-foreground">
            {node.dashboards.length}
          </span>
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
  return (
    <div
      className="rounded-md py-1.5 pr-2 hover:bg-accent/50"
      style={{ paddingLeft: `${depth * 20 + 26}px` }}
    >
      <Link
        to={
          resource === "runbook"
            ? "/runbooks/$project/$slug"
            : "/dashboards/$project/$slug"
        }
        params={{ project: dashboard.project, slug: dashboard.slug }}
        className="flex min-w-0 flex-col gap-0.5"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{dashboard.name}</span>
          {path && (
            <span className="truncate text-xs text-muted-foreground">
              {path}
            </span>
          )}
          <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">
            {dashboard.panelCount > 0 && `${dashboard.panelCount} panels · `}
            {formatRelativeTime(dashboard.updatedAt)}
          </span>
        </div>
        {dashboard.description && (
          <span className="truncate pl-6 text-xs text-muted-foreground">
            {dashboard.description}
          </span>
        )}
      </Link>
    </div>
  );
}
