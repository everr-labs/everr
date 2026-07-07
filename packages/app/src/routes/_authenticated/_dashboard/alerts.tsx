import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PageContainer } from "@/components/page-container";

export const Route = createFileRoute("/_authenticated/_dashboard/alerts")({
  staticData: { breadcrumb: "Alerts", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Alerts" }] }),
  component: CcAlertingLayout,
});

// Section navigation (Triage/History/Rules/Delivery/Silences) lives in the
// sidebar; this layout only carries the header and the scroll container.
function CcAlertingLayout() {
  // The shared `_dashboard` column is `overflow-hidden`; like `_padded`, this
  // layout owns its own scroll so tall pages (delivery, rule detail) scroll
  // instead of clipping.
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-y-contain">
      <PageContainer>
        <div className="border-b border-border pb-3">
          <h1 className="text-xl font-bold tracking-tight">Alerts</h1>
          <p className="text-sm text-muted-foreground">
            Prometheus-style alerting over your telemetry: triage, history,
            rules, delivery, and silences, evaluated against ClickHouse.
          </p>
        </div>
        <Outlet />
      </PageContainer>
    </div>
  );
}
