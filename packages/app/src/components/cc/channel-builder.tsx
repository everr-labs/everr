// packages/app/src/components/cc/channel-builder.tsx
//
// Backs the /alerts/delivery page's address book. A channel is a named,
// reusable endpoint config; receivers reference channels by name. The per-type
// config forms live here (they used to sit inline in the receiver builder,
// back when receivers carried their configs).
import { Button } from "@everr/ui/components/button";
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
import { ccQueries } from "@/data/cc/queries";
import { createCcChannel } from "@/data/cc/server";
import type { CcChannelConfig } from "@/data/cc/types";
import { CcDrawer } from "./cc-drawer";
import { CHANNEL_LABEL, type ChannelType } from "./channel-meta";

/** The config form state: every per-type field kept side by side so switching
 * the type back and forth never loses input. */
type ConfigDraft = {
  type: ChannelType;
  url: string;
  routingKey: string;
  to: string[];
  botToken: string;
  chatIds: string[];
};

const EMPTY_DRAFT: ConfigDraft = {
  type: "webhook",
  url: "",
  routingKey: "",
  to: [],
  botToken: "",
  chatIds: [],
};

function draftToConfig(d: ConfigDraft): CcChannelConfig | null {
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

export function ChannelBuilder({
  open,
  onOpenChange,
  existingNames,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Names already taken. CC's create is an upsert by name, so reusing one
   * would silently replace that channel's config; block it client-side. */
  existingNames: string[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<ConfigDraft>(EMPTY_DRAFT);

  const duplicate = existingNames.includes(name.trim());
  const config = draftToConfig(draft);

  const patch = (p: Partial<ConfigDraft>) => setDraft((d) => ({ ...d, ...p }));

  const create = useMutation({
    mutationFn: () => {
      if (!config) throw new Error("channel config is incomplete");
      return createCcChannel({ data: { name: name.trim(), config } });
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ccQueries.channels().queryKey });
      onOpenChange(false);
      toast.success(`Channel "${c.name}" created`);
    },
    onError: (e) => toast.error(ccErrorMessage(e)),
  });

  return (
    <CcDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="New channel"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || duplicate || !config || create.isPending}
            onClick={() => create.mutate()}
          >
            Create channel
          </Button>
        </>
      }
    >
      <CcConceptNote>
        A channel is a named delivery endpoint that any number of receivers can
        reference. Secret fields (Slack URL, PagerDuty key, Telegram token) are
        write-only: the engine redacts them on read, and re-creating a channel
        under the same name rotates its secret in place.
      </CcConceptNote>
      <div className="space-y-1.5">
        <Label htmlFor="channel-name">Name</Label>
        <Input
          id="channel-name"
          value={name}
          aria-invalid={duplicate ? true : undefined}
          onChange={(e) => setName(e.target.value)}
          placeholder="team-slack"
        />
        {duplicate && (
          <p className="text-destructive text-xs" role="alert">
            A channel with this name already exists
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="channel-type">Type</Label>
        <Select
          value={draft.type}
          onValueChange={(v) =>
            patch({ type: (v ?? "webhook") as ChannelType })
          }
        >
          <SelectTrigger id="channel-type" className="w-full">
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
      {(draft.type === "webhook" || draft.type === "slack") && (
        <div className="space-y-1.5">
          <Label htmlFor="channel-url">
            {draft.type === "slack" ? "Incoming webhook URL" : "Webhook URL"}
          </Label>
          <Input
            id="channel-url"
            type="url"
            className="font-mono"
            value={draft.url}
            onChange={(e) => patch({ url: e.target.value })}
            placeholder={
              draft.type === "slack"
                ? "https://hooks.slack.com/services/..."
                : "https://example.com/hook"
            }
          />
        </div>
      )}
      {draft.type === "pagerduty" && (
        <div className="space-y-1.5">
          <Label htmlFor="channel-routing-key">Routing key</Label>
          <Input
            id="channel-routing-key"
            className="font-mono"
            value={draft.routingKey}
            onChange={(e) => patch({ routingKey: e.target.value })}
            placeholder="R0..."
          />
        </div>
      )}
      {draft.type === "email" && (
        <div className="space-y-1.5">
          <Label>Recipients</Label>
          <TagsInput
            aria-label="Recipient addresses"
            placeholder="oncall@example.com"
            value={draft.to}
            onValueChange={(to) => patch({ to })}
          />
        </div>
      )}
      {draft.type === "telegram" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="channel-bot-token">Bot token</Label>
            <Input
              id="channel-bot-token"
              className="font-mono"
              value={draft.botToken}
              onChange={(e) => patch({ botToken: e.target.value })}
              placeholder="123456789:ABC..."
            />
          </div>
          <div className="space-y-1.5">
            <Label>Chat IDs</Label>
            <TagsInput
              aria-label="Chat IDs"
              placeholder="-1001234567890"
              value={draft.chatIds}
              onValueChange={(chatIds) => patch({ chatIds })}
            />
          </div>
        </>
      )}
    </CcDrawer>
  );
}
