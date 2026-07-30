import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ScrollPage } from "@/components/page-container";

export const Route = createFileRoute("/_authenticated/_dashboard/alerts")({
  staticData: { breadcrumb: "Alerting", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Alerting" }] }),
  component: CcAlertingLayout,
});

// Section navigation (Triage/SLOs/Rules/Delivery) lives in the sidebar; this
// layout only carries the header, with the scroll container shared with
// `_padded` (ScrollPage) so tall pages (delivery, rule detail) scroll instead
// of clipping.
function CcAlertingLayout() {
  return (
    <ScrollPage>
      <Outlet />
    </ScrollPage>
  );
}
