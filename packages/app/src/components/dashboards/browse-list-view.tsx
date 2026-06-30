import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { Link } from "@tanstack/react-router";
import { Folder, LayoutDashboard, NotebookText } from "lucide-react";
import type { BrowseContents, BrowseResource } from "./dashboard-browser";

export function BrowseListView({
  contents,
  resource,
}: {
  contents: BrowseContents;
  resource: BrowseResource;
}) {
  const Icon = resource === "runbook" ? NotebookText : LayoutDashboard;
  const detailTo =
    resource === "runbook"
      ? "/runbooks/$project/$slug"
      : "/dashboards/$project/$slug";

  if (contents.folders.length === 0 && contents.items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        This folder is empty.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {contents.folders.map((f) => (
        <Link
          key={f.path}
          to="."
          search={(p) => ({ ...p, folder: f.path, q: undefined })}
          className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-accent/50"
        >
          <Folder className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{f.name}</span>
          {f.count > 0 && (
            <span className="text-xs text-muted-foreground">{f.count}</span>
          )}
        </Link>
      ))}
      {contents.items.map(({ item, path }) => (
        <Link
          key={`${item.project}/${item.slug}`}
          to={detailTo}
          params={{ project: item.project, slug: item.slug }}
          className="flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-accent/50"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{item.name}</span>
          {path && (
            <span className="truncate text-xs text-muted-foreground">
              {path}
            </span>
          )}
          <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">
            {formatRelativeTime(item.updatedAt)}
          </span>
        </Link>
      ))}
    </div>
  );
}
