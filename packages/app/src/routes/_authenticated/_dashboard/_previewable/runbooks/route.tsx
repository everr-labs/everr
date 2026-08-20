import {
  createFileRoute,
  Outlet,
  retainSearchParams,
  useSearch,
} from "@tanstack/react-router";
import { FrameToggle } from "@/components/rail/frame-toggle";
import { RailFrame, railFrameRouteOptions } from "@/components/rail/rail-frame";
import { RunbooksList } from "@/components/runbooks/runbooks-list";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/runbooks",
)({
  ...railFrameRouteOptions,
  search: { middlewares: [retainSearchParams(["full"])] },
  component: RunbooksLayout,
});

/**
 * Runbooks in the shared rail frame. The runbook's own pages get no rail of
 * their own: they float in the margin left of the reading column (see
 * RunbookPagesNav), which keeps the runbook centered and the frame down to one
 * navigation column.
 */
function RunbooksLayout() {
  const { full } = Route.useSearch();
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });

  return (
    <RailFrame
      label="Runbooks"
      full={full ?? false}
      rail={<RunbooksList preview={preview} />}
    >
      {/*
        Named container: the pages nav floats or lies down by how much room
        this pane has, which the viewport alone cannot tell it. The router
        resets this pane to the top on navigation, keyed off
        `data-scroll-to-top` (see `scrollToTopSelectors` in router.tsx).
      */}
      <main
        data-scroll-to-top
        className="@container/pane min-h-0 min-w-0 overflow-auto overscroll-y-contain"
      >
        {/* The toggle belongs to the rail, not to the runbook, so it sits at
            the pane's edge against it rather than over the centered text. */}
        <div className="p-3 pb-2">
          <FrameToggle listLabel="runbook list" />
        </div>
        {/* Every step up widens the reading column and the navs floating
            beside it together, so the margins never shrink below what they
            need. `relative` is what those navs pin themselves to.

            No top padding: a floating nav pins to this box, so padding here
            would start the text below the nav and the two would not line up.
            The space above the text belongs to the toggle row instead. */}
        <div className="relative mx-auto w-full max-w-2xl px-3 pb-3 @[76rem]/pane:max-w-3xl @[88rem]/pane:max-w-4xl">
          <Outlet />
        </div>
      </main>
    </RailFrame>
  );
}
