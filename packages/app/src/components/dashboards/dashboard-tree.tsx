import { cn } from "@everr/ui/lib/utils";
import { Link, type LinkProps, useMatchRoute } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  LayoutDashboard,
  NotebookText,
} from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { PreviewStatusBadge } from "@/components/preview-status-badge";
import {
  buildTree,
  type DashboardSummary,
  type FolderNode,
  folderAncestorPaths,
  searchItems,
} from "@/data/dashboards/tree";

type TreeResource = "dashboard" | "runbook";

export const railRowClass =
  "rounded-md py-1.5 transition-colors hover:bg-muted/50";
export const railRowActiveProps = {
  className: "bg-muted text-foreground [&>svg]:text-primary",
};

/** Left padding of a resource row at `depth`, and of the label inside it. */
export const rowIndent = (depth: number) => depth * 20 + 26;
export const rowLabelIndent = (depth: number) => rowIndent(depth) + 24;

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
  /**
   * Rows to render directly under an item, for resources that have an inner
   * structure of their own (runbook pages). Called for every item; return null
   * for the ones that have nothing to show.
   */
  renderChildren?: (item: DashboardSummary, depth: number) => ReactNode;
  /**
   * Decides which row is the open one, instead of leaving it to route
   * matching. Runbooks need it: their rows sit above routes of their own, so
   * a row would keep the highlight while one of its pages already holds it.
   */
  rowActive?: (item: DashboardSummary) => boolean;
}

export function DashboardTree({
  dashboards,
  search,
  resource = "dashboard",
  renderChildren,
  rowActive,
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

  const rowProps = { resource, renderChildren, rowActive, selected };

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

const NO_ACTIVE_PROPS = {};

/** The parts every row in one tree shares, threaded down unchanged. */
interface RowContext {
  resource: TreeResource;
  renderChildren?: (item: DashboardSummary, depth: number) => ReactNode;
  rowActive?: (item: DashboardSummary) => boolean;
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
  renderChildren,
  rowActive,
  selected,
}: {
  dashboard: DashboardSummary;
  depth: number;
  path?: string;
} & RowContext) {
  const Icon = resource === "runbook" ? NotebookText : LayoutDashboard;
  const removed = dashboard.previewStatus === "removed";
  // The open resource keeps its icon lit even when a child row (a runbook
  // page) holds the row highlight, so the tree never stops saying which
  // resource you are inside.
  const isSelected =
    selected !== undefined &&
    selected.project === dashboard.project &&
    selected.slug === dashboard.slug;
  const active = rowActive?.(dashboard);
  return (
    <>
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
          active && railRowActiveProps.className,
          isSelected && "[&>svg]:text-primary",
          removed && "opacity-50",
        )}
        style={{ paddingLeft: `${rowIndent(depth)}px` }}
        // With `rowActive` the caller owns the state, so route matching must
        // not add a second, contradictory answer.
        activeProps={rowActive ? NO_ACTIVE_PROPS : railRowActiveProps}
        aria-current={active ? "page" : undefined}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm">{dashboard.name}</span>
        {path && (
          <span className="truncate text-xs text-muted-foreground">{path}</span>
        )}
        <PreviewStatusBadge status={dashboard.previewStatus} />
      </Link>
      {renderChildren?.(dashboard, depth)}
    </>
  );
}
