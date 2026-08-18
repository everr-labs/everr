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
import { Inbox, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import {
  deleteAlertingChannel,
  updateAlertingReceiver,
} from "@/data/alerting/delivery/server";
import type { AlertingChannel, AlertingReceiver } from "@/data/alerting/types";
import { ChannelBuilder } from "./channel-builder";
import { CHANNEL_ICON, CHANNEL_LABEL, channelTarget } from "./channel-meta";
import {
  ConfirmDeleteAction,
  DeleteOperations,
  SectionBody,
  SectionHeading,
} from "./section-chrome";

const CHANNEL_KIND_LIST = new Intl.ListFormat("en", {
  type: "disjunction",
}).format(Object.values(CHANNEL_LABEL));

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

export function ChannelsSection({
  receivers,
  editing,
  onEditingChange,
  onEditReceiver,
}: {
  receivers: AlertingReceiver[] | undefined;
  editing: AlertingChannel | "new" | null;
  onEditingChange: (editing: AlertingChannel | "new" | null) => void;
  onEditReceiver: (receiver: AlertingReceiver) => void;
}) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(
    deliveryQueries.channels(),
  );

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
          Saved secrets are hidden after you leave this page.
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            className="h-10 sm:h-8"
            onClick={() => onEditingChange("new")}
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
            icon: Inbox,
            title: "No channels defined",
            hint: `Add a ${CHANNEL_KIND_LIST} endpoint for receivers to deliver through.`,
          }}
        >
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((c) => {
              const Icon = CHANNEL_ICON[c.config.type];
              const target = channelTarget(c.config);
              const referencingReceivers = (receivers ?? []).filter((r) =>
                r.channels.includes(c.name),
              );
              const usedBy =
                receivers === undefined
                  ? undefined
                  : referencingReceivers.length;
              const blockingReceivers = referencingReceivers.filter(
                (receiver) => receiver.channels.length === 1,
              );
              const confirmDisabledReason =
                receivers === undefined
                  ? "Receiver references are still loading or unavailable. Try again after the Receivers section is ready."
                  : blockingReceivers.length > 0
                    ? `${blockingReceivers.map((receiver) => receiver.name).join(", ")} ${blockingReceivers.length === 1 ? "has" : "have"} no other channel. Add another channel there first. No changes will be made.`
                    : undefined;
              return (
                <li
                  key={c.name}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{c.name}</span>
                    </div>
                    {target !== "" && target !== "***" && (
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {target}
                      </div>
                    )}
                    {usedBy !== undefined &&
                      (usedBy === 0 ? (
                        <div
                          className={cn(
                            "text-xs",
                            toneText({ tone: "warning" }),
                          )}
                        >
                          not referenced by any receiver
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          {usedBy} {usedBy === 1 ? "receiver" : "receivers"}
                        </div>
                      ))}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {c.config.type}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-lg"
                    className="size-10 sm:size-8"
                    aria-label={`Edit channel ${c.name}`}
                    onClick={() => onEditingChange(c)}
                  >
                    <Pencil />
                  </Button>
                  <ConfirmDeleteAction
                    label={`Delete channel ${c.name}`}
                    title={`Delete “${c.name}”?`}
                    description={
                      blockingReceivers.length > 0
                        ? `This channel is the only channel for ${blockingReceivers.length} ${blockingReceivers.length === 1 ? "receiver" : "receivers"}, so it cannot be removed automatically yet.`
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
      <ChannelBuilder
        key={editing === "new" ? "new" : (editing?.name ?? "closed")}
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) onEditingChange(null);
        }}
        existingNames={(data ?? []).map((c) => c.name)}
        channel={editing === "new" ? null : editing}
      />
    </Card>
  );
}
