import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import { ruleQueries } from "@/data/alerting/rules/queries";
import type { AlertingChannel } from "@/data/alerting/types";
import { ChannelsSection } from "./-components/delivery/channels-section";
import { DeliverySection } from "./-components/delivery/delivery-section";
import { RuleOverridesSection } from "./-components/delivery/rule-overrides-section";

const NotificationsSearchSchema = z.object({
  new: z.enum(["channel"]).optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/notifications",
)({
  // Channels and the default destination are live operational config, not an
  // as-code resource a preview branch overlays, so the preview banner would be
  // misleading here.
  staticData: { breadcrumb: "Notifications", hidePreviewFrame: true },
  head: () => ({ meta: [{ title: "Everr - Alert notifications" }] }),
  validateSearch: NotificationsSearchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.prefetchQuery(deliveryQueries.channels()),
      queryClient.prefetchQuery(deliveryQueries.defaultDestination()),
      queryClient.prefetchQuery(ruleQueries.rules()),
    ]),
  component: AlertingNotificationsPage,
});

function AlertingNotificationsPage() {
  const search = Route.useSearch();
  const channels = useQuery(deliveryQueries.channels());
  const destination = useQuery(deliveryQueries.defaultDestination());

  // Lazy initial state, not an effect: `?new=` says how the page was entered.
  const [channelEditing, setChannelEditing] = useState<
    AlertingChannel | "new" | null
  >(() => (search.new === "channel" ? "new" : null));
  const [deliveryEditing, setDeliveryEditing] = useState(false);

  return (
    <div className="space-y-3">
      <PageHeader
        title="Notifications"
        lede="Where alerts are sent: every alert delivers to the default destination."
        docsHref="https://everr.dev/docs/guides/set-up-notifications"
      />
      <DeliverySection
        channels={channels.data ?? []}
        editing={deliveryEditing}
        onEditingChange={setDeliveryEditing}
      />
      <ChannelsSection
        destination={destination.data}
        editing={channelEditing}
        onEditingChange={setChannelEditing}
      />
      <RuleOverridesSection />
    </div>
  );
}
