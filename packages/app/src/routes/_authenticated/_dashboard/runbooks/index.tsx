import { Input } from "@everr/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, NotebookText, SearchIcon } from "lucide-react";
import { useState } from "react";
import { DashboardTree } from "@/components/dashboards/dashboard-tree";
import { ResourceEmptyState } from "@/components/resource-empty-state";
import { runbookListOptions } from "@/data/runbooks/options";

const ASSISTANT_RUNBOOK_PROMPT =
  "/everr-setup-resources Help me build a good first runbook based on the telemetry we have in production";

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

      {!isEmpty && (
        <div className="relative mb-4 max-w-sm">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search runbooks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!isLoading && isError && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <AlertCircle className="size-10" />
          <p className="text-sm">
            {error instanceof Error ? error.message : "Failed to load runbooks"}
          </p>
        </div>
      )}

      {isEmpty && (
        <ResourceEmptyState
          title="No runbooks yet"
          description="Paste this into your coding assistant. It writes the YAML, applies it, and the runbook shows up here."
          assistantPrompt={ASSISTANT_RUNBOOK_PROMPT}
          docsHref="https://everr.dev/docs/learn/add-a-runbook"
        />
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
