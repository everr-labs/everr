import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import {
  createAlertingReceiver,
  updateAlertingReceiver,
} from "@/data/alerting/delivery/server";
import type { AlertingChannel, AlertingReceiver } from "@/data/alerting/types";
import { AlertingDrawer } from "../common/drawer";
import { alertingErrorMessage } from "../common/query-error";
import {
  CHANNEL_ICON,
  CHANNEL_LABEL,
  type ChannelType,
  channelTargetSummary,
} from "./channel-meta";
import { ChannelTypeLauncher } from "./channel-type-picker";
import { isDuplicateName } from "./name-validation";

/** A receiver in progress, held while the reader steps out to add a channel. */
export type ReceiverDraft = { name: string; channels: string[] };

export function ReceiverBuilder({
  open,
  onOpenChange,
  existingNames,
  channels,
  receiver: editing = null,
  draft: initialDraft = null,
  onAddChannel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existingNames: string[];
  channels: AlertingChannel[];
  /** Edit target; the caller remounts (key) per target, so state inits here. */
  receiver?: AlertingReceiver | null;
  /** A draft to resume, from a trip through the channel builder. */
  draft?: ReceiverDraft | null;
  /** Leave for the channel builder, carrying this draft back afterwards. */
  onAddChannel?: (type: ChannelType | null, draft: ReceiverDraft) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initialDraft?.name ?? editing?.name ?? "");
  const [selected, setSelected] = useState<string[]>(
    initialDraft?.channels ?? editing?.channels ?? [],
  );

  const duplicate = isDuplicateName(existingNames, name.trim(), editing?.name);

  const toggle = (channelName: string) =>
    setSelected((s) =>
      s.includes(channelName)
        ? s.filter((n) => n !== channelName)
        : [...s, channelName],
    );

  const save = useMutation({
    mutationFn: () => {
      if (selected.length === 0) throw new Error("pick at least one channel");
      const trimmed = name.trim();
      return editing
        ? updateAlertingReceiver({
            data: {
              name: editing.name,
              newName: trimmed,
              channels: selected,
            },
          })
        : createAlertingReceiver({
            data: { name: trimmed, channels: selected },
          });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: deliveryQueries.receivers().queryKey });
      onOpenChange(false);
      toast.success(`Receiver "${r.name}" ${editing ? "updated" : "created"}`);
    },
    onError: (e) => toast.error(alertingErrorMessage(e)),
  });

  return (
    <AlertingDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit receiver" : "New receiver"}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !name.trim() ||
              duplicate ||
              selected.length === 0 ||
              save.isPending
            }
            onClick={() => save.mutate()}
          >
            {editing ? "Save receiver" : "Create receiver"}
          </Button>
        </>
      }
    >
      <div className="space-y-1.5">
        <Label htmlFor="receiver-name">Name</Label>
        <Input
          id="receiver-name"
          value={name}
          aria-invalid={duplicate ? true : undefined}
          onChange={(e) => setName(e.target.value)}
          placeholder="oncall"
        />
        {duplicate ? (
          <p className="text-destructive text-xs" role="alert">
            A receiver with this name already exists
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Routes address a receiver by this name.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Channels</Label>
        {channels.length === 0 ? (
          <div className="space-y-2 rounded-md border border-dashed p-3">
            <p className="text-xs text-muted-foreground" role="alert">
              A receiver delivers through channels, and there are none yet. Add
              the first one; this draft is waiting when you come back.
            </p>
            <ChannelTypeLauncher
              labelPrefix="Add a channel:"
              onPick={(type) =>
                onAddChannel?.(type, { name, channels: selected })
              }
            />
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border/60 overflow-hidden rounded-md border">
              {channels.map((c) => {
                const Icon = CHANNEL_ICON[c.config.type];
                const target = channelTargetSummary(c.config);
                return (
                  <li key={c.name}>
                    <label className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-muted/50">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-primary"
                        checked={selected.includes(c.name)}
                        aria-label={`Channel ${c.name}`}
                        onChange={() => toggle(c.name)}
                      />
                      <Icon aria-hidden className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">
                          {c.name}
                        </span>
                        <span
                          className={cn(
                            "block truncate text-[0.6875rem] text-muted-foreground",
                            target.literal && "font-mono",
                          )}
                        >
                          {target.text}
                        </span>
                      </span>
                      <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                        {CHANNEL_LABEL[c.config.type]}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {selected.length === 0
                  ? "Pick at least one channel"
                  : selected.length === 1
                    ? "Every alert routed here goes to that channel."
                    : `Every alert routed here goes to all ${selected.length} channels.`}
              </p>
              {onAddChannel && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onAddChannel(null, { name, channels: selected })
                  }
                >
                  <Plus data-icon="inline-start" />
                  New channel
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </AlertingDrawer>
  );
}
