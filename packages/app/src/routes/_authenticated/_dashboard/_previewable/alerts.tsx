import { createFileRoute } from "@tanstack/react-router";

// Section navigation (Triage/Rules/Delivery) lives in the sidebar, and
// the `_previewable` parent owns the scroll column, page inset, and preview
// bar; this route only carries the section's breadcrumb and head metadata.
export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts",
)({
  staticData: { breadcrumb: "Alerting", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Alerting" }] }),
});
