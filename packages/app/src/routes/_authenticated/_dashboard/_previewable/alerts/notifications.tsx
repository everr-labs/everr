import { RetryError } from "@everr/ui/components/retry-error";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChannelDialog } from "@/components/alerts/channel-dialog";
import { DeliveryDialog } from "@/components/alerts/delivery-dialog";
import { NotificationsPage } from "@/components/alerts/notifications-page";
import { alertNotificationsOptions } from "@/data/alerting/delivery/options";
import { useNotificationControls } from "@/hooks/use-notification-controls";
import { useTimeRange } from "@/hooks/use-time-range";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/notifications",
)({
  // Channels and the default destination are live operational config, not an
  // as-code resource a preview branch overlays, so the preview banner would be
  // misleading here. `fullBleed` hands the page its own scroll and runs its
  // lists edge to edge, the same contract Triage and Silences sign.
  staticData: {
    breadcrumb: "Notifications",
    hidePreviewFrame: true,
    fullBleed: true,
  },
  head: () => ({ meta: [{ title: "Everr - Alert notifications" }] }),
  component: AlertingNotificationsPage,
});

function AlertingNotificationsPage() {
  const { timeRange } = useTimeRange();
  // The delivery record on every row is scoped to the selected range, the
  // way the Silences page's history is.
  const notifications = useQuery(alertNotificationsOptions(timeRange));
  const data = notifications.data ?? null;
  const controls = useNotificationControls(data);

  if (notifications.isError) {
    return (
      <div className="h-full overflow-auto p-3">
        <RetryError
          title="Could not load notifications"
          message={notifications.error.message}
          onRetry={() => void notifications.refetch()}
        />
      </div>
    );
  }

  return (
    <>
      <div className="h-full min-h-0 overflow-auto overscroll-y-contain pb-6">
        <NotificationsPage
          data={data}
          pending={controls.pending}
          onNewChannel={controls.channel.openNew}
          onEditChannel={controls.channel.openEdit}
          onEditDelivery={controls.delivery.show}
        />
      </div>
      <ChannelDialog
        target={controls.channel.target}
        existingNames={data?.channels.map((c) => c.name) ?? []}
        inDefault={controls.channel.inDefault}
        pending={controls.pending}
        onClose={controls.channel.close}
        onSave={controls.channel.save}
        onDelete={controls.channel.remove}
      />
      {data && (
        <DeliveryDialog
          open={controls.delivery.open}
          channels={data.channels}
          destination={data.destination}
          pending={controls.pending}
          onClose={controls.delivery.close}
          onConfirm={controls.delivery.save}
        />
      )}
    </>
  );
}
