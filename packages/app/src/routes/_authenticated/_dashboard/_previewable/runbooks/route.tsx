import { cn } from "@everr/ui/lib/utils";
import { createFileRoute, Outlet, useSearch } from "@tanstack/react-router";
import * as z from "zod";
import { RunbookPagesRail } from "@/components/runbooks/runbook-pages-rail";
import { RunbooksList } from "@/components/runbooks/runbooks-list";
import {
  useOpenRunbook,
  useOpenRunbookPages,
} from "@/components/runbooks/use-open-runbook";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/runbooks",
)({
  staticData: { fullBleed: true },
  // Full screen hides both navigation columns and gives the whole width to the
  // open runbook. In the URL so a full-screen runbook is linkable and survives
  // a reload: a deep link from an alert can land directly on it.
  validateSearch: z.object({
    full: z.boolean().optional().catch(undefined),
  }),
  component: RunbooksLayout,
});

/**
 * The frame every runbook renders in: the runbook rail, then the pages of the
 * open runbook, then the runbook itself. Two navigation levels rather than one
 * mixed list, because a runbook and its pages are different questions: which
 * runbook am I reading, and where am I inside it.
 */
function RunbooksLayout() {
  const { full } = Route.useSearch();
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });
  const open = useOpenRunbook();
  const pages = useOpenRunbookPages(open, preview);

  // Every track is a fixed length so the toggle animates: a track that
  // collapses to `auto` has nothing to interpolate towards.
  const columns = full
    ? "md:grid-cols-[0px_0px_minmax(0,1fr)]"
    : pages
      ? "md:grid-cols-[var(--rail)_var(--pages)_minmax(0,1fr)]"
      : "md:grid-cols-[var(--rail)_0px_minmax(0,1fr)]";

  return (
    <div
      className={cn(
        "grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] [--pages:13rem] [--rail:260px] md:grid-rows-[minmax(0,1fr)] md:transition-[grid-template-columns] md:duration-200 md:ease-sidebar motion-reduce:md:transition-none",
        columns,
      )}
    >
      {/*
        `overflow-hidden` plus the fixed-width inner column keep each rail's
        content from reflowing while the track animates; the rows inside keep
        their own scroll.
      */}
      <aside
        inert={full}
        aria-label="Runbooks"
        className={cn(
          "min-h-0 min-w-0 overflow-hidden border-b bg-muted/15 md:border-r md:border-b-0",
          // Stacked on narrow viewports the rail stays expanded: it is
          // navigation, so hiding it behind a button would bury the only way
          // to switch runbooks. The rows scroll inside it.
          "max-md:max-h-[38dvh]",
          full && "max-md:hidden md:border-r-0",
        )}
      >
        <div className="flex h-full min-h-0 flex-col p-3 md:w-[var(--rail)]">
          <RunbooksList preview={preview} />
        </div>
      </aside>
      {/*
        Never `hidden`: taking this column out of the flow would shift the
        runbook itself into the collapsed track. It empties instead, so the
        zero-width track and the missing padding do the hiding.
      */}
      <aside
        inert={full || !pages}
        className={cn(
          "min-h-0 min-w-0 overflow-hidden bg-muted/8",
          open && pages && !full && "border-b md:border-r md:border-b-0",
        )}
      >
        {open && pages && !full && (
          <div className="flex h-full min-h-0 flex-col p-3 max-md:py-2 md:w-[var(--pages)]">
            <RunbookPagesRail open={open} pages={pages} />
          </div>
        )}
      </aside>
      <main className="min-h-0 min-w-0 overflow-auto overscroll-y-contain">
        <div className="mx-auto w-full max-w-3xl p-3">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
