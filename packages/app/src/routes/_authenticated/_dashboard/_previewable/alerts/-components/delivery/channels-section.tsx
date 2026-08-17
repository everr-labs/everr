import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from "@everr/ui/components/card";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Pencil, Plus, Send, SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { AlertingChannelHealth } from "@/data/alerting/delivery/health";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import {
  deleteAlertingChannel,
  testAlertingSavedChannel,
  updateAlertingReceiver,
} from "@/data/alerting/delivery/server";
import type { AlertingChannel, AlertingReceiver } from "@/data/alerting/types";
import { alertingErrorMessage } from "../common/query-error";
import { ChannelHealthLine } from "./channel-health";
import {
  CHANNEL_ICON,
  CHANNEL_LABEL,
  channelTargetSummary,
} from "./channel-meta";
import {
  ConfirmDeleteAction,
  DeleteOperations,
  SectionBody,
  SectionHeading,
} from "./section-chrome";

function ChannelDeleteOperations({
  channelName,
  referencingReceivers,
}: {
  channelName: string;
  referencingReceivers: AlertingReceiver[];
}) {
  return (
    <DeleteOperations>
      {referencingReceivers.map((receiver) => (
        <li key={receiver.id} className="pl-1">
          Remove <span className="font-mono">{channelName}</span> from{" "}
          <strong className="font-medium text-foreground">
            {receiver.name}
          </strong>
          . It keeps{" "}
          <span className="font-mono text-foreground">
            {receiver.channels
              .filter((name) => name !== channelName)
              .join(", ")}
          </span>
          .
        </li>
      ))}
      <li className="pl-1">
        Delete <span className="font-mono">{channelName}</span>.
      </li>
    </DeleteOperations>
  );
}

/** Which receivers deliver through this channel, or that none of them do. */
function ChannelUsage({
  receivers,
  onAttach,
}: {
  /** undefined while the receivers are unknown: say nothing rather than guess. */
  receivers: AlertingReceiver[] | undefined;
  onAttach: () => void;
}) {
  if (receivers === undefined) return null;
  if (receivers.length === 0) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-2 text-xs",
          toneText({ tone: "warning" }),
        )}
      >
        In no receiver, so nothing delivers here
        <Button variant="ghost" size="sm" onClick={onAttach}>
          Add to a receiver
        </Button>
      </span>
    );
  }
  return (
    <span className="min-w-0 truncate text-xs text-muted-foreground">
      In{" "}
      <span className="text-foreground">
        {receivers.map((r) => r.name).join(", ")}
      </span>
    </span>
  );
}

export function ChannelsSection({
  receivers,
  onNewChannel,
  onEditChannel,
  onEditReceiver,
  onAttachToReceiver,
}: {
  receivers: AlertingReceiver[] | undefined;
  onNewChannel: () => void;
  onEditChannel: (channel: AlertingChannel) => void;
  onEditReceiver: (receiver: AlertingReceiver) => void;
  /** Start a receiver that already holds this channel. */
  onAttachToReceiver: (channelName: string) => void;
}) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(
    deliveryQueries.channels(),
  );
  // Delivery history is a bonus fact, never a gate: a failing ClickHouse read
  // must not take the configuration surface down with it.
  const health = useQuery({
    ...deliveryQueries.channelHealth(),
    throwOnError: false,
  });
  const healthByChannel = new Map<string, AlertingChannelHealth>(
    (health.data ?? []).map((row) => [row.channel, row]),
  );

  const test = useMutation({
    mutationFn: (name: string) => testAlertingSavedChannel({ data: { name } }),
    onSuccess: (result, name) => {
      if (result.ok) {
        toast.success(
          `Test message delivered to ${name} in ${result.latency_ms}ms`,
        );
      } else {
        toast.error(
          `${name} did not deliver: ${result.error ?? "unknown error"}`,
        );
      }
    },
    onError: (e) => toast.error(alertingErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async ({
      name,
      referencingReceivers,
    }: {
      name: string;
      referencingReceivers: AlertingReceiver[];
    }) => {
      await Promise.all(
        referencingReceivers.map((receiver) =>
          updateAlertingReceiver({
            data: {
              name: receiver.name,
              channels: receiver.channels.filter(
                (channelName) => channelName !== name,
              ),
            },
          }),
        ),
      );
      await deleteAlertingChannel({ data: { name } });
      return referencingReceivers.length;
    },
    onSuccess: (receiverCount) => {
      toast.success(
        receiverCount === 0
          ? "Channel deleted"
          : `Channel deleted and ${receiverCount} ${receiverCount === 1 ? "receiver" : "receivers"} updated`,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: deliveryQueries.channels().queryKey });
      qc.invalidateQueries({ queryKey: deliveryQueries.receivers().queryKey });
    },
  });

  return (
    <Card id="channels" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <SectionHeading>Channels</SectionHeading>
        <CardDescription>
          One endpoint each. Secrets are write-only: they never come back out.
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            className="h-10 sm:h-8"
            onClick={onNewChannel}
          >
            <Plus data-icon="inline-start" />
            New channel
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <SectionBody
          isError={isError}
          error={error}
          isPending={isPending}
          skeletonRows={3}
          empty={{
            when: (data ?? []).length === 0,
            icon: Send,
            title: "No channels yet",
            hint: "A channel is where a notification lands: a Slack or Discord webhook, a Telegram chat, or any URL that takes JSON.",
          }}
        >
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((c) => {
              const Icon = CHANNEL_ICON[c.config.type];
              const target = channelTargetSummary(c.config);
              const referencingReceivers = (receivers ?? []).filter((r) =>
                r.channels.includes(c.name),
              );
              const blockingReceivers = referencingReceivers.filter(
                (receiver) => receiver.channels.length === 1,
              );
              const confirmDisabledReason =
                receivers === undefined
                  ? "Receiver references are still loading or unavailable. Try again after the Receivers section is ready."
                  : blockingReceivers.length > 0
                    ? `${blockingReceivers.map((receiver) => receiver.name).join(", ")} ${blockingReceivers.length === 1 ? "has" : "have"} no other channel. Add another channel there first. No changes will be made.`
                    : undefined;
              const testing = test.isPending && test.variables === c.name;
              return (
                <li
                  key={c.name}
                  className="flex items-start gap-3 px-3 py-2.5 transition-colors duration-200 hover:bg-muted/30"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {CHANNEL_LABEL[c.config.type]}
                      </span>
                    </div>
                    {/* Its own line: an endpoint is long, and a row that makes
                        it compete with the name truncates both on a phone. */}
                    <div
                      className={cn(
                        "truncate text-xs text-muted-foreground",
                        target.literal && "font-mono",
                      )}
                      title={target.literal ? target.text : undefined}
                    >
                      {target.text}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <ChannelUsage
                        receivers={
                          receivers === undefined
                            ? undefined
                            : referencingReceivers
                        }
                        onAttach={() => onAttachToReceiver(c.name)}
                      />
                      <ChannelHealthLine health={healthByChannel.get(c.name)} />
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="size-10 sm:size-8"
                    aria-label={`Send test to ${c.name}`}
                    title="Send a test message"
                    disabled={test.isPending}
                    onClick={() => test.mutate(c.name)}
                  >
                    {testing ? (
                      <LoaderCircle className="motion-safe:animate-spin" />
                    ) : (
                      <SendHorizontal />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="size-10 sm:size-8"
                    aria-label={`Edit channel ${c.name}`}
                    onClick={() => onEditChannel(c)}
                  >
                    <Pencil />
                  </Button>
                  <ConfirmDeleteAction
                    label={`Delete channel ${c.name}`}
                    title={`Delete “${c.name}”?`}
                    description={
                      blockingReceivers.length > 0
                        ? `This channel is the only destination for ${blockingReceivers.length} ${blockingReceivers.length === 1 ? "receiver" : "receivers"}, so it cannot be removed automatically yet.`
                        : referencingReceivers.length === 0
                          ? "No receiver uses this channel. Past notifications keep its name in their record. This cannot be undone."
                          : `This will update ${referencingReceivers.length} ${referencingReceivers.length === 1 ? "receiver" : "receivers"} before deleting the channel. This cannot be undone.`
                    }
                    confirmLabel="Delete channel"
                    pending={remove.isPending}
                    details={
                      confirmDisabledReason === undefined ? (
                        <ChannelDeleteOperations
                          channelName={c.name}
                          referencingReceivers={referencingReceivers}
                        />
                      ) : undefined
                    }
                    confirmDisabledReason={confirmDisabledReason}
                    blockedAction={
                      blockingReceivers.length > 0
                        ? {
                            label: `Edit ${blockingReceivers[0]?.name}`,
                            onClick: () => {
                              const receiver = blockingReceivers[0];
                              if (receiver) onEditReceiver(receiver);
                            },
                          }
                        : undefined
                    }
                    onConfirm={() =>
                      remove.mutateAsync({
                        name: c.name,
                        referencingReceivers,
                      })
                    }
                  />
                </li>
              );
            })}
          </ul>
        </SectionBody>
      </CardContent>
    </Card>
  );
}
