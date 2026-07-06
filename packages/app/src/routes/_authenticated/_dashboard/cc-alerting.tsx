import { createFileRoute, Outlet } from "@tanstack/react-router";
import { CcAlertingTabs } from "@/components/cc/shared";
import { PageContainer } from "@/components/page-container";

export const Route = createFileRoute("/_authenticated/_dashboard/cc-alerting")({
  staticData: { breadcrumb: "Advanced alerting", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Advanced Alerting" }] }),
  component: CcAlertingLayout,
});

function CcAlertingLayout() {
  // The shared `_dashboard` column is `overflow-hidden`; like `_padded`, this
  // layout owns its own scroll so tall pages (routing, rule detail) scroll
  // instead of clipping.
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-y-contain">
      <PageContainer>
        <div className="flex flex-col gap-3">
          <h1 className="text-xl font-bold tracking-tight">
            Advanced alerting
          </h1>
          <CcAlertingTabs />
        </div>
        <Outlet />
      </PageContainer>
    </div>
  );
}
