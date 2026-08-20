import { cn } from "@everr/ui/lib/utils";
import { createFileRoute, Outlet, useSearch } from "@tanstack/react-router";
import * as z from "zod";
import { RunbooksList } from "@/components/runbooks/runbooks-list";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/runbooks",
)({
  staticData: { fullBleed: true },
  // Full screen hides the runbook list and gives the whole width to the open
  // runbook. In the URL so a full-screen runbook is linkable and survives a
  // reload: a deep link from an alert can land directly on it.
  validateSearch: z.object({
    full: z.boolean().optional().catch(undefined),
  }),
  component: RunbooksLayout,
});

/**
 * The master-detail frame every runbook renders in, shaped like the dashboards
 * frame: a 260px tinted, bordered rail as the first grid column, and the open
 * runbook as a pane that scrolls itself, so the page never scrolls.
 *
 * The runbook's own pages get no rail. They float in the margin left of the
 * reading column (see RunbookPagesNav), which keeps the runbook centered and
 * the frame down to one navigation column.
 */
function RunbooksLayout() {
  const { full } = Route.useSearch();
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });

  // Both directions of the toggle live inside the runbook toolbar
  // (`FrameToggle` via RunbookViewer). Full mode keeps the same grid and
  // animates the rail's track to zero, so the runbook slides over instead of
  // snapping.
  return (
    <div
      className={cn(
        "grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] [--rail:260px] md:grid-rows-[minmax(0,1fr)] md:transition-[grid-template-columns] md:duration-200 md:ease-sidebar motion-reduce:md:transition-none",
        full
          ? "md:grid-cols-[0px_minmax(0,1fr)]"
          : "md:grid-cols-[var(--rail)_minmax(0,1fr)]",
      )}
    >
      {/*
        `overflow-hidden` plus the fixed-width inner column keep the rail's
        content from reflowing while the track animates; the rows inside keep
        their own scroll (RunbooksList).
      */}
      <aside
        inert={full}
        aria-label="Runbooks"
        className={cn(
          "min-h-0 min-w-0 overflow-hidden border-b bg-muted/15 md:border-r md:border-b-0",
          // Stacked on narrow viewports the rail stays expanded: it is
          // navigation, so hiding it behind a button would bury the only way
          // to switch runbooks. Just under half the viewport leaves the open
          // runbook the larger share; the rows scroll.
          "max-md:max-h-[45dvh]",
          full && "max-md:hidden md:border-r-0",
        )}
      >
        <div className="flex h-full min-h-0 flex-col p-3 md:w-[var(--rail)]">
          <RunbooksList preview={preview} />
        </div>
      </aside>
      {/* Named container: the runbook's pages nav floats or lies down by how
          much room this pane has, which the viewport alone cannot tell it.
          `relative` is what that floating nav pins itself to. */}
      <main className="@container/pane min-h-0 min-w-0 overflow-auto overscroll-y-contain">
        <div className="relative mx-auto w-full max-w-2xl p-3">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
