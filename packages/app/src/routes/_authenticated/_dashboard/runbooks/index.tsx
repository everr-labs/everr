import { Input } from "@everr/ui/components/input";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, NotebookText, SearchIcon } from "lucide-react";
import { useState } from "react";
import { DashboardTree } from "@/components/dashboards/dashboard-tree";
import { InstallCommandBlock } from "@/components/install-command-block";
import { runbookListOptions } from "@/data/runbooks/options";

export const Route = createFileRoute("/_authenticated/_dashboard/runbooks/")({
  staticData: { breadcrumb: "Runbooks" },
  head: () => ({ meta: [{ title: "Everr - Runbooks" }] }),
  component: RunbooksIndexPage,
});

function RunbooksIndexPage() {
  const {
    data: runbooks,
    isLoading,
    isError,
    error,
  } = useQuery(runbookListOptions());
  const [search, setSearch] = useState("");
  const isEmpty = !isLoading && !isError && (runbooks?.length ?? 0) === 0;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <NotebookText className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Runbooks</h1>
      </div>

      <div className="relative mb-4 max-w-sm">
        <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search runbooks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-2 py-1.5 pl-[26px]">
              <Skeleton className="mt-0.5 size-4 shrink-0 rounded" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-72" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && isError && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <AlertCircle className="size-10" />
          <p className="text-sm">
            {error instanceof Error ? error.message : "Failed to load runbooks"}
          </p>
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <NotebookText className="size-10 text-muted-foreground" />
          <h2 className="text-sm font-medium">No runbooks yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Runbooks turn investigations into repeatable, shareable docs. Define
            them as code and apply them with the everr CLI.
          </p>
          <div className="w-full max-w-sm">
            <InstallCommandBlock command="everr apply ./runbooks" />
          </div>
        </div>
      )}

      {!isLoading && !isError && !isEmpty && (
        <DashboardTree
          dashboards={runbooks ?? []}
          search={search}
          resource="runbook"
        />
      )}
    </div>
  );
}
