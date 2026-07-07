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
import { useState } from "react";
import { toast } from "sonner";
import { CcConceptNote, ccErrorMessage } from "@/components/cc/shared";
import { createCcReceiver } from "@/data/cc/server";
import type { CcReceiver } from "@/data/cc/types";

type ChannelType = CcReceiver["channel"]["type"];

// The engine's channel enum (ChannelConfig in clickety-clack's
// domain/receiver.rs) with its per-type fields.
const CHANNEL_LABEL: Record<ChannelType, string> = {
  webhook: "Webhook",
  slack: "Slack",
  pagerduty: "PagerDuty",
  email: "Email",
  telegram: "Telegram",
};

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
  const [type, setType] = useState<ChannelType>("webhook");
  const [url, setUrl] = useState("");
  const [routingKey, setRoutingKey] = useState("");
  const [to, setTo] = useState<string[]>([]);
  const [botToken, setBotToken] = useState("");
  const [chatIds, setChatIds] = useState<string[]>([]);

  const duplicate = existingNames.includes(name.trim());
  const channel = ((): CcReceiver["channel"] | null => {
    switch (type) {
      case "webhook":
      case "slack":
        return url ? { type, url } : null;
      case "pagerduty":
        return routingKey ? { type, routing_key: routingKey } : null;
      case "email":
        return to.length > 0 ? { type, to } : null;
      case "telegram":
        return botToken && chatIds.length > 0
          ? { type, bot_token: botToken, chat_ids: chatIds }
          : null;
    }
  })();

  const create = useMutation({
    mutationFn: () => {
      if (!channel) throw new Error("channel is incomplete");
      return createCcReceiver({ data: { name: name.trim(), channel } });
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
            A receiver is a delivery channel routes send matching alerts to.
            Secret fields (Slack URL, PagerDuty key, Telegram token) are
            write-only: the engine redacts them on read.
          </CcConceptNote>
          <div className="grid grid-cols-2 gap-3">
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
              <Label htmlFor="receiver-type">Channel</Label>
              <Select
                value={type}
                onValueChange={(v) => setType((v ?? "webhook") as ChannelType)}
              >
                <SelectTrigger id="receiver-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CHANNEL_LABEL) as ChannelType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {CHANNEL_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {(type === "webhook" || type === "slack") && (
            <div className="space-y-1.5">
              <Label htmlFor="receiver-url">
                {type === "slack" ? "Incoming webhook URL" : "Webhook URL"}
              </Label>
              <Input
                id="receiver-url"
                type="url"
                className="font-mono"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  type === "slack"
                    ? "https://hooks.slack.com/services/..."
                    : "https://example.com/hook"
                }
              />
            </div>
          )}
          {type === "pagerduty" && (
            <div className="space-y-1.5">
              <Label htmlFor="receiver-routing-key">Routing key</Label>
              <Input
                id="receiver-routing-key"
                className="font-mono"
                value={routingKey}
                onChange={(e) => setRoutingKey(e.target.value)}
                placeholder="R0..."
              />
            </div>
          )}
          {type === "email" && (
            <div className="space-y-1.5">
              <Label>Recipients</Label>
              <TagsInput
                aria-label="Recipient addresses"
                placeholder="oncall@example.com"
                value={to}
                onValueChange={setTo}
              />
            </div>
          )}
          {type === "telegram" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="receiver-bot-token">Bot token</Label>
                <Input
                  id="receiver-bot-token"
                  className="font-mono"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="123456789:ABC..."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Chat IDs</Label>
                <TagsInput
                  aria-label="Chat IDs"
                  placeholder="-1001234567890"
                  value={chatIds}
                  onValueChange={setChatIds}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              !name.trim() || duplicate || channel === null || create.isPending
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
