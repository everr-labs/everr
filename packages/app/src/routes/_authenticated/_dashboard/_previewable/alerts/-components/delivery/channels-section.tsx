import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from "@everr/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import { deleteAlertingChannel } from "@/data/alerting/delivery/server";
import type {
  AlertingChannel,
  AlertingDefaultDestination,
} from "@/data/alerting/types";
import { SectionHeading } from "../common/section-heading";
import { ChannelBuilder } from "./channel-builder";
import { CHANNEL_ICON, CHANNEL_LABEL, channelTarget } from "./channel-meta";
import { ConfirmDeleteAction, SectionBody } from "./section-chrome";

const CHANNEL_KIND_LIST = new Intl.ListFormat("en", {
  type: "disjunction",
}).format(Object.values(CHANNEL_LABEL));

function channelIsDefault(
  destination: AlertingDefaultDestination | undefined,
  channelName: string,
): boolean {
  return Object.values(destination?.tiers ?? {}).some((names) =>
    names.includes(channelName),
  );
}

export function ChannelsSection({
  destination,
  editing,
  onEditingChange,
}: {
  destination: AlertingDefaultDestination | undefined;
  editing: AlertingChannel | "new" | null;
  onEditingChange: (editing: AlertingChannel | "new" | null) => void;
}) {
  const qc = useQueryClient();
  const { data, isPending, isError, error } = useQuery(
    deliveryQueries.channels(),
  );

  const remove = useMutation({
    mutationFn: (name: string) => deleteAlertingChannel({ data: { name } }),
    onSuccess: () => toast.success("Channel deleted"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: deliveryQueries.channels().queryKey });
      qc.invalidateQueries({
        queryKey: deliveryQueries.defaultDestination().queryKey,
      });
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
            hint: `Add a ${CHANNEL_KIND_LIST} endpoint for alerts to deliver through.`,
          }}
        >
          <ul className="divide-y divide-border/60">
            {(data ?? []).map((c) => {
              const Icon = CHANNEL_ICON[c.config.type];
              const target = channelTarget(c.config);
              const isDefault = channelIsDefault(destination, c.name);
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
                      {isDefault && (
                        <span className="rounded-sm border border-primary/40 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-primary">
                          default
                        </span>
                      )}
                    </div>
                    {target !== "" && target !== "***" && (
                      <div className="truncate font-mono text-xs text-muted-foreground">
                        {target}
                      </div>
                    )}
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
                      isDefault
                        ? "This channel is part of the default destination and will drop out of it. Rules naming it directly fall back to the default destination. Past notifications keep its name in their record. This cannot be undone."
                        : "Rules naming this channel directly fall back to the default destination. Past notifications keep its name in their record. This cannot be undone."
                    }
                    confirmLabel="Delete channel"
                    pending={remove.isPending}
                    onConfirm={() => remove.mutateAsync(c.name)}
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
