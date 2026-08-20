import { cn } from "@everr/ui/lib/utils";
import { Link, type LinkProps, useMatchRoute } from "@tanstack/react-router";
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
  folderAncestorPaths,
  searchItems,
} from "@/data/dashboards/tree";

type TreeResource = "dashboard" | "runbook";

const railRowClass = "rounded-md py-1.5 transition-colors hover:bg-muted/50";
const railRowActiveProps = {
  className: "bg-muted text-foreground [&>svg]:text-primary",
};

/** Left padding of a resource row at `depth`. */
const rowIndent = (depth: number) => depth * 20 + 26;

/** The heading over a group of rail rows. */
export const groupLabelClass =
  "font-semibold text-[0.6875rem] text-foreground/75 uppercase tracking-wider";

/** One rail row that is not part of the tree: a plain labelled destination. */
export function RailRow({
  label,
  icon: Icon,
  ...linkProps
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
} & LinkProps) {
  return (
    <Link
      {...linkProps}
      className={cn(
        railRowClass,
        "flex w-full items-center gap-2.5 px-2 text-left text-foreground",
      )}
      activeProps={railRowActiveProps}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
    </Link>
  );
}

interface DashboardTreeProps {
  dashboards: DashboardSummary[];
  search: string;
  resource?: TreeResource;
}

export function DashboardTree({
  dashboards,
  search,
  resource = "dashboard",
}: DashboardTreeProps) {
  const matchRoute = useMatchRoute();
  // Fuzzy for runbooks: a runbook page is a route below the runbook, and the
  // tree still has to know which runbook is open.
  const match = matchRoute(
    resource === "runbook"
      ? { to: "/runbooks/$project/$slug", fuzzy: true }
      : { to: "/dashboards/$project/$slug" },
  );
  const selected = match
    ? dashboards.find(
        (d) => d.project === match.project && d.slug === match.slug,
      )
    : undefined;

  // Open the folders containing the dashboard selected at mount time. After
  // that `expanded` is purely user-controlled: it never re-seeds when the
  // selection changes, so users can collapse and other folders never
  // auto-open or auto-close.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(selected ? folderAncestorPaths(selected.folderPath) : []),
  );

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

  const rowProps = { resource, selected };

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
              {...rowProps}
            />
          ))}
          {results.dashboards.length === 0 && (
            <p className="px-1 py-1 text-muted-foreground text-xs">
              No {resource} matches that search.
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
              {...rowProps}
            />
          ))}
          {tree.dashboards.map((dashboard) => (
            <DashboardRow
              key={`${dashboard.project}/${dashboard.slug}`}
              dashboard={dashboard}
              depth={0}
              {...rowProps}
            />
          ))}
        </>
      )}
    </div>
  );
}

/** The parts every row in one tree shares, threaded down unchanged. */
interface RowContext {
  resource: TreeResource;
  selected?: DashboardSummary;
}

function FolderRows({
  node,
  depth,
  expanded,
  onToggle,
  ...row
}: {
  node: FolderNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
} & RowContext) {
  const { selected } = row;
  const isExpanded = expanded.has(node.path);
  // A collapsed folder still shows the active row when it lives anywhere in
  // this subtree, same rule as the built-in groups: the list must always say
  // where you are.
  const containsSelected =
    selected !== undefined &&
    (selected.folderPath === node.path ||
      selected.folderPath.startsWith(`${node.path}/`));
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
      {isExpanded ? (
        <>
          {node.subfolders.map((child) => (
            <FolderRows
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              {...row}
            />
          ))}
          {node.dashboards.map((dashboard) => (
            <DashboardRow
              key={`${dashboard.project}/${dashboard.slug}`}
              dashboard={dashboard}
              depth={depth + 1}
              {...row}
            />
          ))}
        </>
      ) : (
        containsSelected &&
        selected && (
          <DashboardRow dashboard={selected} depth={depth + 1} {...row} />
        )
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
} & Omit<RowContext, "selected">) {
  const Icon = resource === "runbook" ? NotebookText : LayoutDashboard;
  const removed = dashboard.previewStatus === "removed";
  return (
    <Link
      to={
        resource === "runbook"
          ? "/runbooks/$project/$slug"
          : "/dashboards/$project/$slug"
      }
      params={{ project: dashboard.project, slug: dashboard.slug }}
      className={cn(
        railRowClass,
        "flex min-w-0 items-center gap-2 pr-1",
        removed && "opacity-50",
      )}
      style={{ paddingLeft: `${rowIndent(depth)}px` }}
      activeProps={railRowActiveProps}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-sm">{dashboard.name}</span>
      {path && (
        <span className="truncate text-xs text-muted-foreground">{path}</span>
      )}
      <PreviewStatusBadge status={dashboard.previewStatus} />
    </Link>
  );
}
