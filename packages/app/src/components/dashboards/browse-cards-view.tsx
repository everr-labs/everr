import { formatRelativeTime } from "@everr/ui/lib/timestamp";
import { Link } from "@tanstack/react-router";
import { Folder, LayoutDashboard, NotebookText } from "lucide-react";
import type { BrowseContents, BrowseResource } from "./dashboard-browser";
import { DashboardCardPreview } from "./dashboard-card-preview";
import { RunbookCardPreview } from "./runbook-card-preview";

export function BrowseCardsView({
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
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {contents.folders.map((f) => (
        <Link
          key={f.path}
          to="."
          search={(p) => ({ ...p, folder: f.path, q: undefined })}
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-3 hover:border-foreground/20 hover:bg-accent/50"
        >
          <Folder className="size-5 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{f.name}</span>
          {f.count > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              {f.count}
            </span>
          )}
        </Link>
      ))}
      {contents.items.map(({ item }) => (
        <Link
          key={`${item.project}/${item.slug}`}
          to={detailTo}
          params={{ project: item.project, slug: item.slug }}
          className="group flex flex-col overflow-hidden rounded-lg border border-border hover:border-foreground/20"
        >
          <div className="aspect-[16/10] border-b border-border bg-muted/30">
            {resource === "dashboard" ? (
              <DashboardCardPreview project={item.project} slug={item.slug} />
            ) : (
              <RunbookCardPreview project={item.project} slug={item.slug} />
            )}
          </div>
          <div className="flex items-center gap-2 px-3 py-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{item.name}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {formatRelativeTime(item.updatedAt)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
