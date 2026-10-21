import { RetryError } from "@everr/ui/components/retry-error";
import { ScrollArea } from "@everr/ui/components/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChannelDialog } from "#app/components/alerts/channel-dialog.tsx";
import { DeliveryDialog } from "#app/components/alerts/delivery-dialog.tsx";
import { NotificationsPage } from "#app/components/alerts/notifications-page.tsx";
import { alertNotificationsOptions } from "#app/data/alerting/delivery/options.ts";
import { useNotificationControls } from "#app/hooks/use-notification-controls.ts";
import { useTimeRange } from "#app/hooks/use-time-range.ts";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/alerts/notifications",
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
  const controls = useNotificationControls();

  if (notifications.isError) {
    return (
      <ScrollArea className="h-full" viewportClassName="p-3">
        <RetryError
          title="Could not load notifications"
          message={notifications.error.message}
          onRetry={() => void notifications.refetch()}
        />
      </ScrollArea>
    );
  }

  return (
    <>
      <ScrollArea className="h-full min-h-0" viewportClassName="overscroll-y-contain pb-6">
        <NotificationsPage
          data={data}
          pending={controls.pending}
          onNewChannel={controls.channel.openNew}
          onEditChannel={controls.channel.openEdit}
          onEditDelivery={controls.delivery.show}
        />
      </ScrollArea>
      <ChannelDialog
        target={controls.channel.target}
        channels={data?.channels ?? []}
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
