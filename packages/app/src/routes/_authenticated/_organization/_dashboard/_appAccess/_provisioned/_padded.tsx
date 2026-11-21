import { ScrollingPageContainer } from "@everr/app-shell/page";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded",
)({
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
