import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import type { AlertingChannel, AlertingReceiver } from "@/data/alerting/types";
import { ChannelBuilder } from "./-components/delivery/channel-builder";
import type { ChannelType } from "./-components/delivery/channel-meta";
import { ChannelsSection } from "./-components/delivery/channels-section";
import {
  ReceiverBuilder,
  type ReceiverDraft,
} from "./-components/delivery/receiver-builder";
import { ReceiversSection } from "./-components/delivery/receivers-section";
import { AlertingSetupGuide } from "./-components/delivery/setup-guide";

const NotificationsSearchSchema = z.object({
  new: z.enum(["receiver", "channel"]).optional().catch(undefined),
});

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/notifications",
)({
  // Receivers/channels are live operational config, not an as-code resource a
  // preview branch overlays, so the preview banner would be misleading here.
  staticData: { breadcrumb: "Notifications", hidePreviewFrame: true },
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

/** The channel builder's target, plus how the reader got there. */
type ChannelFlow = {
  target: AlertingChannel | "new" | null;
  /** Preselected type for a new channel, when the entry point chose one. */
  type: ChannelType | null;
  /** A receiver draft to return to once the channel exists. */
  resume: ReceiverDraft | null;
};

type ReceiverFlow = {
  target: AlertingReceiver | "new" | null;
  draft: ReceiverDraft | null;
};

const NO_CHANNEL_FLOW: ChannelFlow = { target: null, type: null, resume: null };
const NO_RECEIVER_FLOW: ReceiverFlow = { target: null, draft: null };

function AlertingNotificationsPage() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const receivers = useQuery(deliveryQueries.receivers());
  const channels = useQuery(deliveryQueries.channels());
  // Read-only here: the receiver card refuses to delete a receiver a route
  // still targets, and the guide's last step is about routes existing at all.
  const routes = useQuery(deliveryQueries.routes());

  // Lazy initial state, not an effect: `?new=` says how the page was entered.
  const [receiverFlow, setReceiverFlow] = useState<ReceiverFlow>(() =>
    search.new === "receiver"
      ? { target: "new", draft: null }
      : NO_RECEIVER_FLOW,
  );
  const [channelFlow, setChannelFlow] = useState<ChannelFlow>(() =>
    search.new === "channel"
      ? { target: "new", type: null, resume: null }
      : NO_CHANNEL_FLOW,
  );

  const openChannel = (type: ChannelType | null) => {
    setReceiverFlow(NO_RECEIVER_FLOW);
    setChannelFlow({ target: "new", type, resume: null });
  };

  const openReceiver = (draft: ReceiverDraft | null = null) => {
    setChannelFlow(NO_CHANNEL_FLOW);
    setReceiverFlow({ target: "new", draft });
  };

  // One drawer at a time: the receiver in progress is held rather than lost,
  // and the channel that gets created lands in it already selected.
  const leaveForChannel = (type: ChannelType | null, draft: ReceiverDraft) => {
    setReceiverFlow(NO_RECEIVER_FLOW);
    setChannelFlow({ target: "new", type, resume: draft });
  };

  const resumeAfterChannel = (createdName: string) => {
    const resume = channelFlow.resume;
    if (!resume) return;
    setReceiverFlow({
      target: "new",
      draft: { name: resume.name, channels: [...resume.channels, createdName] },
    });
  };

  const channelCount = channels.data?.length ?? 0;
  const receiverCount = receivers.data?.length ?? 0;
  const setupKnown =
    channels.data !== undefined &&
    receivers.data !== undefined &&
    routes.data !== undefined;
  // Both lists empty is the one case the guide answers better than two empty
  // states saying the same thing twice.
  const unconfigured = setupKnown && channelCount === 0 && receiverCount === 0;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Notifications"
        lede="Channels are the endpoints alerts land in. Receivers group the channels a route delivers to."
        docsHref="https://everr.dev/docs/guides/set-up-notifications"
      />
      {setupKnown && (
        <AlertingSetupGuide
          state={{
            channelCount,
            receiverCount,
            routeCount: routes.data?.length ?? 0,
          }}
          onAddChannel={openChannel}
          onAddReceiver={() => openReceiver()}
          onOpenRouting={() => navigate({ to: "/alerts/routing" })}
        />
      )}
      {!unconfigured && (
        <>
          <ChannelsSection
            receivers={receivers.data}
            onNewChannel={() => openChannel(null)}
            onEditChannel={(channel) =>
              setChannelFlow({ target: channel, type: null, resume: null })
            }
            onEditReceiver={(receiver) => {
              setChannelFlow(NO_CHANNEL_FLOW);
              setReceiverFlow({ target: receiver, draft: null });
            }}
            onAttachToReceiver={(channelName) =>
              openReceiver({ name: "", channels: [channelName] })
            }
          />
          <ReceiversSection
            channels={channels.data ?? []}
            routes={routes.data}
            onNewReceiver={() => openReceiver()}
            onEditReceiver={(receiver) => {
              setChannelFlow(NO_CHANNEL_FLOW);
              setReceiverFlow({ target: receiver, draft: null });
            }}
            onReviewRoutes={() => navigate({ to: "/alerts/routing" })}
          />
        </>
      )}
      <ChannelBuilder
        key={`channel-${
          channelFlow.target === "new"
            ? `new-${channelFlow.type ?? "unpicked"}-${channelFlow.resume ? "resume" : "plain"}`
            : (channelFlow.target?.name ?? "closed")
        }`}
        open={channelFlow.target !== null}
        onOpenChange={(o) => {
          if (!o) setChannelFlow(NO_CHANNEL_FLOW);
        }}
        existingNames={(channels.data ?? []).map((c) => c.name)}
        channel={channelFlow.target === "new" ? null : channelFlow.target}
        initialType={channelFlow.target === "new" ? channelFlow.type : null}
        onCreated={resumeAfterChannel}
      />
      <ReceiverBuilder
        key={`receiver-${
          receiverFlow.target === "new"
            ? `new-${receiverFlow.draft?.channels.join() ?? "plain"}`
            : (receiverFlow.target?.name ?? "closed")
        }`}
        open={receiverFlow.target !== null}
        onOpenChange={(o) => {
          if (!o) setReceiverFlow(NO_RECEIVER_FLOW);
        }}
        existingNames={(receivers.data ?? []).map((r) => r.name)}
        channels={channels.data ?? []}
        receiver={receiverFlow.target === "new" ? null : receiverFlow.target}
        draft={receiverFlow.draft}
        onAddChannel={leaveForChannel}
      />
    </div>
  );
}
