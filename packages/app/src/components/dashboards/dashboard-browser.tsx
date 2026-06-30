import { Input } from "@everr/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@everr/ui/components/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronRight, LayoutGrid, List, SearchIcon } from "lucide-react";
import { useMemo } from "react";
import {
  breadcrumbSegments,
  buildTree,
  type DashboardSort,
  type DashboardSummary,
  nodeAtPath,
  searchItems,
} from "@/data/dashboards/tree";
import { BrowseCardsView } from "./browse-cards-view";
import { BrowseListView } from "./browse-list-view";

export type BrowseResource = "dashboard" | "runbook";
export interface BrowseFolder {
  name: string;
  path: string;
  count: number;
}
export interface BrowseEntry {
  item: DashboardSummary;
  path?: string;
}
export interface BrowseContents {
  folders: BrowseFolder[];
  items: BrowseEntry[];
}

interface BrowseSearch {
  folder?: string;
  view?: "list" | "cards";
  sort?: DashboardSort;
  q?: string;
}

export function DashboardBrowser({
  items,
  resource,
}: {
  items: DashboardSummary[];
  resource: BrowseResource;
}) {
  const search = useSearch({ strict: false }) as BrowseSearch;
  const navigate = useNavigate();
  const folder = search.folder ?? "";
  const sort: DashboardSort = search.sort ?? "updated";
  const q = search.q ?? "";
  const view: "list" | "cards" = search.view ?? "list";
  const searching = q.trim().length > 0;

  const tree = useMemo(() => buildTree(items, sort), [items, sort]);

  const contents = useMemo<BrowseContents>(() => {
    if (searching) {
      const r = searchItems(items, q, sort);
      return {
        folders: [],
        items: r.dashboards.map(({ dashboard, path }) => ({
          item: dashboard,
          path,
        })),
      };
    }
    const node = folder ? nodeAtPath(tree, folder) : null;
    const folders = folder ? (node?.subfolders ?? []) : tree.folders;
    const dashboards = folder ? (node?.dashboards ?? []) : tree.dashboards;
    return {
      folders: folders.map((f) => ({
        name: f.name,
        path: f.path,
        count: f.dashboards.length,
      })),
      items: dashboards.map((item) => ({ item })),
    };
  }, [searching, items, q, sort, folder, tree]);

  const folderMissing =
    !searching && folder.length > 0 && nodeAtPath(tree, folder) === null;
  const crumbs = breadcrumbSegments(folder);
  const rootLabel = resource === "runbook" ? "Runbooks" : "Dashboards";

  return (
    <div className="flex flex-col gap-3">
      {(folder || searching) && (
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link
            to="."
            search={(p) => ({ ...p, folder: undefined, q: undefined })}
            className="hover:text-foreground"
          >
            {rootLabel}
          </Link>
          {crumbs.map((c) => (
            <span key={c.path} className="flex items-center gap-1">
              <ChevronRight className="size-3.5" />
              <Link
                to="."
                search={(p) => ({ ...p, folder: c.path, q: undefined })}
                className="hover:text-foreground"
              >
                {c.name}
              </Link>
            </span>
          ))}
        </nav>
      )}

      <div className="flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={`Search ${resource}s...`}
            value={q}
            onChange={(e) =>
              navigate({
                to: ".",
                replace: true,
                search: (p) => ({ ...p, q: e.target.value || undefined }),
              })
            }
            className="pl-8"
          />
        </div>
        <Select
          value={sort}
          onValueChange={(v) =>
            navigate({ to: ".", search: (p) => ({ ...p, sort: v }) })
          }
        >
          <SelectTrigger className="h-9 w-[160px] text-xs" aria-label="Sort">
            {sort === "updated" ? "Recently updated" : "Name"}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Recently updated</SelectItem>
            <SelectItem value="name">Name</SelectItem>
          </SelectContent>
        </Select>
        <ToggleGroup
          value={[view]}
          onValueChange={(values) => {
            const v = values[0] as "list" | "cards" | undefined;
            if (v) navigate({ to: ".", search: (p) => ({ ...p, view: v }) });
          }}
        >
          <ToggleGroupItem value="list" aria-label="List view">
            <List className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="cards" aria-label="Cards view">
            <LayoutGrid className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {folderMissing ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          That folder no longer exists.{" "}
          <Link
            to="."
            search={(p) => ({ ...p, folder: undefined })}
            className="underline hover:text-foreground"
          >
            Back to {rootLabel}
          </Link>
        </p>
      ) : view === "cards" ? (
        <BrowseCardsView contents={contents} resource={resource} />
      ) : (
        <BrowseListView contents={contents} resource={resource} />
      )}
    </div>
  );
}
