// packages/app/src/components/cc/receiver-builder.tsx
//
// Backs the /alerts/routing page's "Receivers" section. A receiver is a named
// set of channel REFERENCES: the builder picks from the tenant's existing
// channels (created in the Channels section); the per-type config forms live
// in the channel builder now.
import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CHANNEL_LABEL } from "@/components/cc/channel-builder";
import { CcConceptNote, ccErrorMessage } from "@/components/cc/shared";
import { createCcReceiver } from "@/data/cc/server";
import type { CcChannel } from "@/data/cc/types";

export function ReceiverBuilder({
  open,
  onOpenChange,
  existingNames,
  channels,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Names already taken. CC's create is an upsert by name, so reusing one
   * would silently replace that receiver; block it client-side instead. */
  existingNames: string[];
  /** The tenant's channels, to pick references from. */
  channels: CcChannel[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const duplicate = existingNames.includes(name.trim());

  const toggle = (channelName: string) =>
    setSelected((s) =>
      s.includes(channelName)
        ? s.filter((n) => n !== channelName)
        : [...s, channelName],
    );

  const create = useMutation({
    mutationFn: () => {
      if (selected.length === 0) throw new Error("pick at least one channel");
      return createCcReceiver({
        data: { name: name.trim(), channels: selected },
      });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["cc", "receivers"] });
      onOpenChange(false);
      toast.success(`Receiver "${r.name}" created`);
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New receiver</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <CcConceptNote>
            A receiver is a named set of channels; routes send matching alerts
            to every channel in the set. Channels are reusable: the same Slack
            hook or PagerDuty key can back any number of receivers.
          </CcConceptNote>
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
                No channels yet. Create one with &ldquo;New channel&rdquo; in
                the Channels section first; receivers deliver through existing
                channels.
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !name.trim() ||
              duplicate ||
              selected.length === 0 ||
              create.isPending
            }
            onClick={() => create.mutate()}
          >
            Create receiver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
