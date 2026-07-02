import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PageContainer } from "@/components/page-container";

export const Route = createFileRoute("/_authenticated/_dashboard/_padded")({
  component: PaddedLayout,
});

// Pathless layout for every page that wants the standard 12px inset (settings,
// home, cost analysis, repos, workflows, …). Being pathless it adds no URL
// segment — child URLs are unchanged. The `_dashboard` scroll column is bare
// (full-bleed by default); pages that want padding opt in by living here, so
// the inset is owned in one place rather than scattered as per-leaf flags.
function PaddedLayout() {
  return (
    <PageContainer>
      <Outlet />
    </PageContainer>
  );
}
