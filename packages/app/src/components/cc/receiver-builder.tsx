// packages/app/src/components/cc/receiver-builder.tsx
//
// Backs the /alerts/routing page's "Receivers" section.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { TagsInput } from "@everr/ui/components/tags-input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CcConceptNote, ccErrorMessage } from "@/components/cc/shared";
import { createCcReceiver } from "@/data/cc/server";
import type { CcReceiver } from "@/data/cc/types";

type CcChannel = CcReceiver["channels"][number];
type ChannelType = CcChannel["type"];

// The engine's channel enum (ChannelConfig in clickety-clack's
// domain/receiver.rs) with its per-type fields.
const CHANNEL_LABEL: Record<ChannelType, string> = {
  webhook: "Webhook",
  slack: "Slack",
  pagerduty: "PagerDuty",
  email: "Email",
  telegram: "Telegram",
};

/** One channel entry's form state: every per-type field kept side by side so
 * switching the type back and forth never loses input. */
type ChannelDraft = {
  key: number;
  type: ChannelType;
  url: string;
  routingKey: string;
  to: string[];
  botToken: string;
  chatIds: string[];
};

let draftKey = 0;
function emptyDraft(): ChannelDraft {
  draftKey += 1;
  return {
    key: draftKey,
    type: "webhook",
    url: "",
    routingKey: "",
    to: [],
    botToken: "",
    chatIds: [],
  };
}

function draftToChannel(d: ChannelDraft): CcChannel | null {
  switch (d.type) {
    case "webhook":
    case "slack":
      return d.url ? { type: d.type, url: d.url } : null;
    case "pagerduty":
      return d.routingKey ? { type: d.type, routing_key: d.routingKey } : null;
    case "email":
      return d.to.length > 0 ? { type: d.type, to: d.to } : null;
    case "telegram":
      return d.botToken && d.chatIds.length > 0
        ? { type: d.type, bot_token: d.botToken, chat_ids: d.chatIds }
        : null;
  }
}

export function ReceiverBuilder({
  open,
  onOpenChange,
  existingNames,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Names already taken. CC's create is an upsert by name, so reusing one
   * would silently replace that receiver; block it client-side instead. */
  existingNames: string[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<ChannelDraft[]>(() => [emptyDraft()]);

  const duplicate = existingNames.includes(name.trim());
  const channels = drafts.map(draftToChannel);
  const allComplete = channels.every((c): c is CcChannel => c !== null);

  const patchDraft = (key: number, patch: Partial<ChannelDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const create = useMutation({
    mutationFn: () => {
      const complete = channels.filter((c): c is CcChannel => c !== null);
      if (complete.length !== drafts.length || complete.length === 0)
        throw new Error("channels are incomplete");
      return createCcReceiver({
        data: { name: name.trim(), channels: complete },
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
            A receiver bundles one or more delivery channels; routes send
            matching alerts to every channel in the bundle. Secret fields (Slack
            URL, PagerDuty key, Telegram token) are write-only: the engine
            redacts them on read.
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
          {drafts.map((d, i) => (
            <div key={d.key} className="space-y-3 rounded-md border p-3">
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor={`receiver-type-${d.key}`}>Channel</Label>
                  <Select
                    value={d.type}
                    onValueChange={(v) =>
                      patchDraft(d.key, {
                        type: (v ?? "webhook") as ChannelType,
                      })
                    }
                  >
                    <SelectTrigger
                      id={`receiver-type-${d.key}`}
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CHANNEL_LABEL) as ChannelType[]).map(
                        (t) => (
                          <SelectItem key={t} value={t}>
                            {CHANNEL_LABEL[t]}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove channel ${i + 1}`}
                  onClick={() =>
                    setDrafts((ds) => ds.filter((x) => x.key !== d.key))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
              {(d.type === "webhook" || d.type === "slack") && (
                <div className="space-y-1.5">
                  <Label htmlFor={`receiver-url-${d.key}`}>
                    {d.type === "slack"
                      ? "Incoming webhook URL"
                      : "Webhook URL"}
                  </Label>
                  <Input
                    id={`receiver-url-${d.key}`}
                    type="url"
                    className="font-mono"
                    value={d.url}
                    onChange={(e) => patchDraft(d.key, { url: e.target.value })}
                    placeholder={
                      d.type === "slack"
                        ? "https://hooks.slack.com/services/..."
                        : "https://example.com/hook"
                    }
                  />
                </div>
              )}
              {d.type === "pagerduty" && (
                <div className="space-y-1.5">
                  <Label htmlFor={`receiver-routing-key-${d.key}`}>
                    Routing key
                  </Label>
                  <Input
                    id={`receiver-routing-key-${d.key}`}
                    className="font-mono"
                    value={d.routingKey}
                    onChange={(e) =>
                      patchDraft(d.key, { routingKey: e.target.value })
                    }
                    placeholder="R0..."
                  />
                </div>
              )}
              {d.type === "email" && (
                <div className="space-y-1.5">
                  <Label>Recipients</Label>
                  <TagsInput
                    aria-label="Recipient addresses"
                    placeholder="oncall@example.com"
                    value={d.to}
                    onValueChange={(to) => patchDraft(d.key, { to })}
                  />
                </div>
              )}
              {d.type === "telegram" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor={`receiver-bot-token-${d.key}`}>
                      Bot token
                    </Label>
                    <Input
                      id={`receiver-bot-token-${d.key}`}
                      className="font-mono"
                      value={d.botToken}
                      onChange={(e) =>
                        patchDraft(d.key, { botToken: e.target.value })
                      }
                      placeholder="123456789:ABC..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Chat IDs</Label>
                    <TagsInput
                      aria-label="Chat IDs"
                      placeholder="-1001234567890"
                      value={d.chatIds}
                      onValueChange={(chatIds) =>
                        patchDraft(d.key, { chatIds })
                      }
                    />
                  </div>
                </>
              )}
            </div>
          ))}
          {drafts.length === 0 && (
            <p className="text-destructive text-xs" role="alert">
              At least one channel is required
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDrafts((ds) => [...ds, emptyDraft()])}
          >
            <Plus data-icon="inline-start" />
            Add channel
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !name.trim() ||
              duplicate ||
              drafts.length === 0 ||
              !allComplete ||
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
