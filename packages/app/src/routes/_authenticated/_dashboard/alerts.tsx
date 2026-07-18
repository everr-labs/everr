import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ScrollPage } from "@/components/page-container";

export const Route = createFileRoute("/_authenticated/_dashboard/alerts")({
  staticData: { breadcrumb: "Alerts", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Alerts" }] }),
  component: CcAlertingLayout,
});

// Section navigation (Triage/History/Rules/Delivery/Silences) lives in the
// sidebar; this layout only carries the header, with the scroll container
// shared with `_padded` (ScrollPage) so tall pages (delivery, rule detail)
// scroll instead of clipping.
function CcAlertingLayout() {
  return (
    <ScrollPage>
      <Outlet />
    </ScrollPage>
  );
}
