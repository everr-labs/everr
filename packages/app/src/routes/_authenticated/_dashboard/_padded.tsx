import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ScrollPage } from "@/components/page-container";

export const Route = createFileRoute("/_authenticated/_dashboard/_padded")({
  component: PaddedLayout,
});

// Standard-inset pages (settings, home, cost analysis, …). ScrollPage owns
// the scroll because the shared `_dashboard` column is `overflow-hidden`.
function PaddedLayout() {
  return (
    <ScrollPage>
      <Outlet />
    </ScrollPage>
  );
}
