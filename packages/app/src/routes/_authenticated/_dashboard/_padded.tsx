import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PageContainer } from "@/components/page-container";

export const Route = createFileRoute("/_authenticated/_dashboard/_padded")({
  component: PaddedLayout,
});

// Pathless layout for every page that wants the standard 12px inset
// (settings, home, cost analysis, repos, workflows, …).
function PaddedLayout() {
  return (
    <PageContainer>
      <Outlet />
    </PageContainer>
  );
}
