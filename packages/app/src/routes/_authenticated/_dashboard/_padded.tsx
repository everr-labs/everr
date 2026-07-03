import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PageContainer } from "@/components/page-container";

export const Route = createFileRoute("/_authenticated/_dashboard/_padded")({
  component: PaddedLayout,
});

// Pathless layout for every page that wants the standard 12px inset
// (settings, home, cost analysis, repos, workflows, …).
//
// Owns its own scroll: the shared `_dashboard` column is `overflow-hidden`, so
// each section scrolls itself (like `_previewable`). This wrapper reproduces the
// column's old flex idiom so `PageContainer`'s `flex-1 min-h-0` fill still works
// — tall content grows and scrolls here; full-height content with its own
// internal scroll fills the container instead. `overscroll-y-contain` keeps the
// rubber-band from chaining out to the pinned chrome.
function PaddedLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-y-contain">
      <PageContainer>
        <Outlet />
      </PageContainer>
    </div>
  );
}
