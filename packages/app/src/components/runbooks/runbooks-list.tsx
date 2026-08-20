import { useQuery } from "@tanstack/react-query";
import { CirclePlus } from "lucide-react";
import { useState } from "react";
import { DashboardTree } from "@/components/dashboards/dashboard-tree";
import { RailRow } from "@/components/rail/rail-row";
import { RailSearch } from "@/components/rail/rail-search";
import { runbookListOptions } from "@/data/runbooks/options";

/** The first navigation level: every runbook in the organization. */
export function RunbooksList({ preview }: { preview?: string }) {
  const [search, setSearch] = useState("");
  const listQuery = useQuery(runbookListOptions(preview));
  const runbooks = listQuery.data ?? [];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
      <RailSearch label="runbooks" value={search} onChange={setSearch} />

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
