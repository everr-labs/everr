import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import { InhibitionsSection } from "./-components/delivery/inhibitions-section";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/inhibitions",
)({
  // Inhibitions are live operational config, not an as-code resource a preview
  // branch overlays, so the preview banner would be misleading here.
  staticData: { breadcrumb: "Inhibitions", hidePreviewFrame: true },
  head: () => ({ meta: [{ title: "Everr - Alert inhibitions" }] }),
  loader: ({ context: { queryClient } }) =>
    queryClient.prefetchQuery(deliveryQueries.inhibitions()),
  component: AlertingInhibitionsPage,
});

function AlertingInhibitionsPage() {
  return (
    <div className="space-y-3">
      <PageHeader
        title="Inhibitions"
        lede="While a source alert fires, matching target alerts are suppressed."
        docsHref="https://everr.dev/docs/guides/set-up-notifications"
      />
      <InhibitionsSection />
    </div>
  );
}
