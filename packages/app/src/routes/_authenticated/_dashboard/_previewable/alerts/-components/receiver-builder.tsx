import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { alertingQueries } from "@/data/alerting/queries";
import {
  createAlertingReceiver,
  updateAlertingReceiver,
} from "@/data/alerting/server";
import type { AlertingChannel, AlertingReceiver } from "@/data/alerting/types";
import { AlertingDrawer } from "./alerting-drawer";
import { CHANNEL_LABEL } from "./channel-meta";
import {
  AlertingConceptNote,
  alertingErrorMessage,
  isDuplicateName,
} from "./shared";

export function ReceiverBuilder({
  open,
  onOpenChange,
  existingNames,
  channels,
  receiver: editing = null,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** alerting engine's create answers 409 for an existing name; block duplicates client-side. */
  existingNames: string[];
  channels: AlertingChannel[];
  /** Edit target; the caller remounts (key) per target, so state inits here. */
  receiver?: AlertingReceiver | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(editing?.name ?? "");
  const [selected, setSelected] = useState<string[]>(editing?.channels ?? []);

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
      qc.invalidateQueries({ queryKey: alertingQueries.receivers().queryKey });
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
      <AlertingConceptNote>
        A receiver is a named set of channels; routes send matching alerts to
        every channel in the set. Channels are reusable: the same Slack hook or
        Telegram bot can back any number of receivers.
      </AlertingConceptNote>
      <div className="space-y-1.5">
        <Label htmlFor="receiver-name">Name</Label>
        <Input
          id="receiver-name"
          value={name}
          aria-invalid={duplicate ? true : undefined}
          onChange={(e) => setName(e.target.value)}
          placeholder="oncall"
        />
        {duplicate && (
          <p className="text-destructive text-xs" role="alert">
            A receiver with this name already exists
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Channels</Label>
        {channels.length === 0 ? (
          <p
            className="rounded-md border border-dashed p-3 text-xs text-muted-foreground"
            role="alert"
          >
            No channels yet. Create one with &ldquo;New channel&rdquo; in the
            Channels section first; receivers deliver through existing channels.
          </p>
        ) : (
          <ul className="max-h-56 overflow-y-auto rounded-md border">
            {channels.map((c) => (
              <li key={c.name} className="border-b last:border-b-0">
                <label className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    checked={selected.includes(c.name)}
                    aria-label={`Channel ${c.name}`}
                    onChange={() => toggle(c.name)}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {c.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {CHANNEL_LABEL[c.config.type]}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {channels.length > 0 && selected.length === 0 && (
          <p className="text-muted-foreground text-xs">
            Pick at least one channel
          </p>
        )}
      </div>
    </AlertingDrawer>
  );
}
