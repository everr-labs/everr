import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ScrollingPageContainer } from "#app/components/page-container.tsx";

export const Route = createFileRoute("/_authenticated/_dashboard/_padded")({
  component: PaddedLayout,
});

// Standard-inset pages (settings, home, cost analysis, ...). Owns its own
// scroll because the shared `_dashboard` column is `overflow-hidden`.
function PaddedLayout() {
  return (
    <ScrollingPageContainer>
      <Outlet />
    </ScrollingPageContainer>
  );
}
