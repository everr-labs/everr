import { useQuery } from "@tanstack/react-query";
import { CirclePlus } from "lucide-react";
import { useState } from "react";
import { DashboardTree } from "#app/components/dashboards/dashboard-tree.tsx";
import { RailList } from "#app/components/rail/rail-list.tsx";
import { RailRow } from "#app/components/rail/rail-row.tsx";
import { runbookListOptions } from "#app/data/runbooks/options.ts";

/** The first navigation level: every runbook in the organization. */
export function RunbooksList({ preview }: { preview?: string }) {
  const [search, setSearch] = useState("");
  const listQuery = useQuery(runbookListOptions(preview));
  const runbooks = listQuery.data ?? [];

  return (
    <RailList label="runbooks" search={search} onSearchChange={setSearch}>
      {listQuery.isLoading && (
        <p className="px-1 py-1 text-muted-foreground text-xs">Loading...</p>
      )}
      {listQuery.isError && (
        <p className="px-1 py-1 text-amber-400 text-xs">
          Couldn't load your runbooks
        </p>
      )}
      {!listQuery.isLoading && !listQuery.isError && runbooks.length === 0 && (
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
    </RailList>
  );
}
