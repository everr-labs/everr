import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, NotebookText } from "lucide-react";
import { z } from "zod";
import { DashboardBrowser } from "@/components/dashboards/dashboard-browser";
import { InstallCommandBlock } from "@/components/install-command-block";
import { runbookListOptions } from "@/data/runbooks/options";

const BrowseSearchSchema = z.object({
  folder: z.string().optional().catch(undefined),
  view: z.enum(["list", "cards"]).optional().catch(undefined),
  sort: z.enum(["updated", "name"]).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_authenticated/_dashboard/runbooks/")({
  validateSearch: BrowseSearchSchema,
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
  const isEmpty = !isLoading && !isError && (runbooks?.length ?? 0) === 0;

  return (
    <div>
      <div className="mb-6 flex items-center gap-2">
        <NotebookText className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Runbooks</h1>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 py-1.5 pl-[26px]">
              <Skeleton className="size-4 shrink-0 rounded" />
              <Skeleton className="h-4 w-48" />
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
        <DashboardBrowser items={runbooks ?? []} resource="runbook" />
      )}
    </div>
  );
}
