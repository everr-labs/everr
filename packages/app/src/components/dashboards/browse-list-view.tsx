import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  LayoutDashboard,
  NotebookText,
} from "lucide-react";
import { useCallback, useState } from "react";
import type { DashboardSummary, FolderNode } from "@/data/dashboards/tree";
import type { BrowseEntry, BrowseResource } from "./dashboard-browser";

export function BrowseListView({
  folders,
  items,
  searchResults,
  resource,
}: {
  folders: FolderNode[];
  items: DashboardSummary[];
  searchResults: BrowseEntry[] | null;
  resource: BrowseResource;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (searchResults) {
    if (searchResults.length === 0) {
      return (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No {resource}s match your search
        </p>
      );
    }
    return (
      <div className="flex flex-col">
        {searchResults.map(({ item, path }) => (
          <ItemRow
            key={`${item.project}/${item.slug}`}
            item={item}
            path={path}
            depth={0}
            resource={resource}
          />
        ))}
      </div>
    );
  }

  if (folders.length === 0 && items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        This folder is empty.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {folders.map((node) => (
        <FolderRows
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          resource={resource}
        />
      ))}
      {items.map((item) => (
        <ItemRow
          key={`${item.project}/${item.slug}`}
          item={item}
          depth={0}
          resource={resource}
        />
      ))}
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
  resource: BrowseResource;
}) {
  const isExpanded = expanded.has(node.path);
  return (
    <>
      <div
        className="flex items-center rounded-md hover:bg-accent/50"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <button
          type="button"
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.name}`}
          aria-expanded={isExpanded}
          onClick={() => onToggle(node.path)}
          className="flex size-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        <Link
          to="."
          search={(p) => ({ ...p, folder: node.path, q: undefined })}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5"
        >
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{node.name}</span>
          {node.dashboards.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {node.dashboards.length}
            </span>
          )}
        </Link>
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
          {node.dashboards.map((item) => (
            <ItemRow
              key={`${item.project}/${item.slug}`}
              item={item}
              depth={depth + 1}
              resource={resource}
            />
          ))}
        </>
      )}
    </>
  );
}

function ItemRow({
  item,
  path,
  depth,
  resource,
}: {
  item: DashboardSummary;
  path?: string;
  depth: number;
  resource: BrowseResource;
}) {
  const Icon = resource === "runbook" ? NotebookText : LayoutDashboard;
  const detailTo =
    resource === "runbook"
      ? "/runbooks/$project/$slug"
      : "/dashboards/$project/$slug";
  return (
    <Link
      to={detailTo}
      params={{ project: item.project, slug: item.slug }}
      className="flex items-center gap-2 rounded-md py-1.5 pr-1 hover:bg-accent/50"
      style={{ paddingLeft: `${depth * 16 + 24}px` }}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-sm font-medium">{item.name}</span>
      {path && (
        <span className="truncate text-xs text-muted-foreground">{path}</span>
      )}
      <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">
        {formatRelativeTime(item.updatedAt)}
      </span>
    </Link>
  );
}
