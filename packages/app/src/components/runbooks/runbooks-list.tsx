import { Input } from "@everr/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { CirclePlus, SearchIcon } from "lucide-react";
import { useState } from "react";
import { DashboardTree, RailRow } from "@/components/dashboards/dashboard-tree";
import { runbookListOptions } from "@/data/runbooks/options";

/** The first navigation level: every runbook in the organization. */
export function RunbooksList({ preview }: { preview?: string }) {
  const [search, setSearch] = useState("");
  const listQuery = useQuery(runbookListOptions(preview));
  const runbooks = listQuery.data ?? [];

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
          />
        )}
      </nav>
    </div>
  );
}
