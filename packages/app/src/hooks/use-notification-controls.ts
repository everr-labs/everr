import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type {
  ChannelDraft,
  ChannelTarget,
} from "@/components/alerts/channel-dialog";
import { invalidateAlertNotifications } from "@/data/alerting/delivery/options";
import {
  createAlertingChannel,
  deleteAlertingChannel,
  setAlertingDefaultDestination,
  updateAlertingChannel,
} from "@/data/alerting/delivery/server";
import type { NotificationChannelView } from "@/data/alerting/delivery/view";
import type { AlertingDefaultDestination } from "@/data/alerting/types";

/**
 * Everything the Notifications page needs to change what it shows: the two
 * dialogs, which one is open on what, and the writes they make. One place
 * owns what a successful write says, what it refreshes, and when a dialog
 * goes away. Takes nothing: a row hands over the channel it draws, the way
 * a triage row hands the silence dialog its seed.
 */
export function useNotificationControls() {
  const queryClient = useQueryClient();
  const refresh = () => invalidateAlertNotifications(queryClient);
  const [channelTarget, setChannelTarget] = useState<ChannelTarget | null>(
    null,
  );
  const [deliveryOpen, setDeliveryOpen] = useState(false);

  const saveChannel = useMutation({
    mutationFn: (draft: ChannelDraft) => {
      const editing = channelTarget?.mode === "edit" ? channelTarget : null;
      return editing
        ? updateAlertingChannel({
            data: {
              name: editing.channel.name,
              newName: draft.name,
              config: draft.config,
            },
          })
        : createAlertingChannel({ data: draft });
    },
    onSuccess: async (channel, draft) => {
      await refresh();
      setChannelTarget(null);
      toast.success(
        channelTarget?.mode === "edit"
          ? `Saved ${channel.name}`
          : `Created ${draft.name}`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteChannel = useMutation({
    mutationFn: (name: string) => deleteAlertingChannel({ data: { name } }),
    onSuccess: async (_result, name) => {
      await refresh();
      setChannelTarget(null);
      toast.success(`Deleted ${name}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveDestination = useMutation({
    mutationFn: (draft: AlertingDefaultDestination) =>
      setAlertingDefaultDestination({ data: draft }),
    onSuccess: async () => {
      await refresh();
      setDeliveryOpen(false);
      toast.success("Default destination saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return {
    pending:
      saveChannel.isPending ||
      deleteChannel.isPending ||
      saveDestination.isPending,
    channel: {
      target: channelTarget,
      openNew: (name = "") => setChannelTarget({ mode: "new", name }),
      openEdit: (channel: NotificationChannelView) =>
        setChannelTarget({ mode: "edit", channel }),
      close: () => setChannelTarget(null),
      save: saveChannel.mutate,
      remove: deleteChannel.mutate,
    },
    delivery: {
      open: deliveryOpen,
      show: () => setDeliveryOpen(true),
      close: () => setDeliveryOpen(false),
      save: saveDestination.mutate,
    },
  };
}
