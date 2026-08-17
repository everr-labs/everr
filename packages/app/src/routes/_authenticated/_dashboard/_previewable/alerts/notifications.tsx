import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import type { AlertingChannel, AlertingReceiver } from "@/data/alerting/types";
import { ChannelsSection } from "./-components/delivery/channels-section";
import { ReceiversSection } from "./-components/delivery/receivers-section";

const NotificationsSearchSchema = z.object({
  new: z.enum(["receiver", "channel"]).optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/notifications",
)({
  staticData: { breadcrumb: "Notifications" },
  head: () => ({ meta: [{ title: "Everr - Alert notifications" }] }),
  validateSearch: NotificationsSearchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.prefetchQuery(deliveryQueries.receivers()),
      queryClient.prefetchQuery(deliveryQueries.channels()),
      queryClient.prefetchQuery(deliveryQueries.routes()),
    ]),
  component: AlertingNotificationsPage,
});

function AlertingNotificationsPage() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const receivers = useQuery(deliveryQueries.receivers());
  const channels = useQuery(deliveryQueries.channels());
  // Read-only: the receiver card refuses to delete a receiver a route still
  // targets, and that guard has to survive routes living on another page.
  const routes = useQuery(deliveryQueries.routes());

  // Lazy initial state, not an effect: `?new=` says how the page was entered.
  const [receiverEditing, setReceiverEditing] = useState<
    AlertingReceiver | "new" | null
  >(() => (search.new === "receiver" ? "new" : null));
  const [channelEditing, setChannelEditing] = useState<
    AlertingChannel | "new" | null
  >(() => (search.new === "channel" ? "new" : null));

  return (
    <div className="space-y-3">
      <PageHeader
        title="Notifications"
        lede="Where alerts are sent: receivers fan out to channels."
        docsHref="https://everr.dev/docs/guides/set-up-notifications"
      />
      <ReceiversSection
        channels={channels.data ?? []}
        routes={routes.data}
        editing={receiverEditing}
        onEditingChange={setReceiverEditing}
        onReviewRoutes={() => navigate({ to: "/alerts/routing" })}
      />
      <ChannelsSection
        receivers={receivers.data}
        editing={channelEditing}
        onEditingChange={setChannelEditing}
        onEditReceiver={setReceiverEditing}
      />
    </div>
  );
}
