import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PageContainer } from "@/components/page-container";

export const Route = createFileRoute("/_authenticated/_dashboard/_padded")({
  component: PaddedLayout,
});

// Standard-inset pages (settings, home, cost analysis, …). Owns its own scroll
// because the shared `_dashboard` column is `overflow-hidden`; the flex idiom
// keeps `PageContainer`'s fill working for both tall and full-height content.
function PaddedLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-y-contain">
      <PageContainer>
        <Outlet />
      </PageContainer>
    </div>
  );
}
