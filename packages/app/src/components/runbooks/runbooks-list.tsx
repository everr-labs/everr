import { Input } from "@everr/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { useMatchRoute } from "@tanstack/react-router";
import { CirclePlus, SearchIcon } from "lucide-react";
import { useState } from "react";
import { DashboardTree, RailRow } from "@/components/dashboards/dashboard-tree";
import { runbookListOptions } from "@/data/runbooks/options";
import { RunbookPageRows } from "./runbook-page-rows";

/** Which runbook the route is on, and which of its pages. */
function useOpenRunbook() {
  const matchRoute = useMatchRoute();
  const page = matchRoute({ to: "/runbooks/$project/$slug/$" });
  if (page)
    return {
      project: page.project,
      slug: page.slug,
      path: page._splat ?? "",
    };
  const index = matchRoute({ to: "/runbooks/$project/$slug" });
  if (index) return { project: index.project, slug: index.slug, path: "" };
  return undefined;
}

/**
 * The rail beside the open runbook: every runbook in the organization, and the
 * pages of the one you are reading, indented under it.
 */
export function RunbooksList({ preview }: { preview?: string }) {
  const [search, setSearch] = useState("");
  const listQuery = useQuery(runbookListOptions(preview));
  const runbooks = listQuery.data ?? [];
  const open = useOpenRunbook();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <div className="relative">
        <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search runbooks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
          aria-label="Search runbooks"
        />
      </div>

      {/* Only the rows scroll; the search stays pinned above. */}
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1 pb-3">
        {listQuery.isLoading && (
          <p className="px-1 py-1 text-muted-foreground text-xs">Loading...</p>
        )}
        {listQuery.isError && (
          <p className="px-1 py-1 text-amber-400 text-xs">
            Couldn't load your runbooks
          </p>
        )}
        {!listQuery.isLoading &&
          !listQuery.isError &&
          runbooks.length === 0 && (
            <RailRow
              label="Create your first runbook"
              icon={CirclePlus}
              to="/runbooks/get-started"
            />
          )}
        {runbooks.length > 0 && (
          <DashboardTree
            dashboards={runbooks}
            search={search}
            resource="runbook"
            // The row stands for the runbook's own index page, so it lights
            // up only there: once a page row holds the highlight, two rows
            // reading as current would say the reader is in both places.
            rowActive={(runbook) =>
              open?.project === runbook.project &&
              open.slug === runbook.slug &&
              open.path === ""
            }
            renderChildren={(runbook, depth) =>
              open &&
              open.project === runbook.project &&
              open.slug === runbook.slug ? (
                <RunbookPageRows
                  project={runbook.project}
                  slug={runbook.slug}
                  preview={preview}
                  activePath={open.path}
                  rowDepth={depth}
                />
              ) : null
            }
          />
        )}
      </nav>
    </div>
  );
}
