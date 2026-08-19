import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/notifications",
)({
  // Channels and the default destination are live operational config, not an
  // as-code resource a preview branch overlays, so the preview banner would be
  // misleading here.
  staticData: { breadcrumb: "Notifications", hidePreviewFrame: true },
  head: () => ({ meta: [{ title: "Everr - Alert notifications" }] }),
  component: AlertingNotificationsPage,
});

function AlertingNotificationsPage() {
  return (
    <div className="space-y-3">
      <PageHeader
        title="Notifications"
        lede="Where alerts are sent: every alert delivers to the default destination."
        docsHref="https://everr.dev/docs/guides/set-up-notifications"
      />
    </div>
  );
}
