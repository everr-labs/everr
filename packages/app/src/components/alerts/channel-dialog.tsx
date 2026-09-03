import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { OptionCombobox } from "@everr/ui/components/option-combobox";
import { TagsInput } from "@everr/ui/components/tags-input";
import { cn } from "@everr/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { testAlertingChannel } from "@/data/alerting/delivery/server";
import type { NotificationChannelView } from "@/data/alerting/delivery/view";
import type { AlertingChannelConfig } from "@/data/alerting/types";
import {
  CHANNEL_ICON,
  CHANNEL_LABEL,
  CHANNEL_TYPES,
  CHANNEL_URL_FIELD,
  type ChannelType,
} from "./channel-mark";

/** What the read hands back for a secret it will never show again. Sent
 *  back as-is on an edit, it tells the server to keep what it has. */
const REDACTED = "***";

/** What the dialog is open on: a channel to make, seeded with a name when a
 *  gap row asked for one, or a channel to change. `null` while closed. */
export type ChannelTarget =
  | { mode: "new"; name: string }
  | { mode: "edit"; channel: NotificationChannelView };

/** What the dialog hands back on save. On an edit, a secret left blank is
 *  the redacted marker, so the server keeps the stored one. */
export type ChannelDraft = {
  name: string;
  config: AlertingChannelConfig;
};

/** Every per-type field kept side by side so switching the type never loses
 *  what was typed. */
type ConfigDraft = {
  type: ChannelType;
  url: string;
  botToken: string;
  chatIds: string[];
};

const EMPTY_DRAFT: ConfigDraft = {
  type: "slack",
  url: "",
  botToken: "",
  chatIds: [],
};

// Secret fields come back redacted, so an edit starts them blank and the
// reader re-enters them; non-secret fields prefill as stored.
function draftFromConfig(config: AlertingChannelConfig): ConfigDraft {
  switch (config.type) {
    case "webhook":
    case "slack":
    case "discord":
      return { ...EMPTY_DRAFT, type: config.type };
    case "telegram":
      return { ...EMPTY_DRAFT, type: config.type, chatIds: config.chat_ids };
  }
}

/**
 * The config the draft describes, or `null` while it cannot be saved. On an
 * edit that keeps the stored kind, a blank secret stands for the stored one.
 */
function draftToConfig(
  d: ConfigDraft,
  keepsSecret: boolean,
): AlertingChannelConfig | null {
  const secret = (typed: string) => typed || (keepsSecret ? REDACTED : "");
  switch (d.type) {
    case "webhook":
    case "slack":
    case "discord": {
      const url = secret(d.url);
      return url ? { type: d.type, url } : null;
    }
    case "telegram": {
      const botToken = secret(d.botToken);
      return botToken && d.chatIds.length > 0
        ? { type: d.type, bot_token: botToken, chat_ids: d.chatIds }
        : null;
    }
  }
}

function hasSecret(config: AlertingChannelConfig): boolean {
  return config.type === "telegram"
    ? config.bot_token !== REDACTED
    : config.url !== REDACTED;
}

export function ChannelDialog({
  target,
  existingNames,
  inDefault,
  pending,
  onClose,
  onSave,
  onDelete,
}: {
  target: ChannelTarget | null;
  /** Every channel name the org has, for the duplicate check. */
  existingNames: string[];
  /** Whether the channel being edited is part of the default destination,
   *  which the delete confirm has to say. */
  inDefault: boolean;
  /** A write is in flight. The dialog stays open and inert until the server
   *  answers: closing early would leave the reader unsure it happened. */
  pending: boolean;
  onClose: () => void;
  onSave: (draft: ChannelDraft) => void;
  onDelete: (name: string) => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      {target && (
        // Remounted per opening, so the fields start from whatever opened
        // this one instead of holding the last opening's text.
        <ChannelForm
          key={
            target.mode === "new" ? `new:${target.name}` : target.channel.name
          }
          target={target}
          existingNames={existingNames}
          inDefault={inDefault}
          pending={pending}
          onClose={onClose}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}
    </Dialog>
  );
}

function ChannelForm({
  target,
  existingNames,
  inDefault,
  pending,
  onClose,
  onSave,
  onDelete,
}: {
  target: ChannelTarget;
  existingNames: string[];
  inDefault: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (draft: ChannelDraft) => void;
  onDelete: (name: string) => void;
}) {
  const editing = target.mode === "edit" ? target.channel : null;
  const [name, setName] = useState(
    target.mode === "new" ? target.name : target.channel.name,
  );
  const [draft, setDraft] = useState<ConfigDraft>(() =>
    editing ? draftFromConfig(editing.config) : EMPTY_DRAFT,
  );
  // The result of the last test, keyed to the config it tested: a result for
  // a config no longer on screen is never shown.
  const [tested, setTested] = useState<{
    config: string;
    ok: boolean;
    latencyMs: number;
    error?: string;
  } | null>(null);

  // Deleting asks first, in place: a second dialog stacked on this one is
  // dismissed by the first as an outside press.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const trimmed = name.trim();
  const duplicate =
    existingNames.includes(trimmed) && trimmed !== editing?.name;
  // A blank secret keeps the stored one only while the kind is unchanged: a
  // Slack channel turned into a webhook has no stored URL to keep.
  const keepsSecret = editing !== null && editing.config.type === draft.type;
  const config = draftToConfig(draft, keepsSecret);
  const urlField = CHANNEL_URL_FIELD[draft.type];
  // A test sends through the config on screen, so a secret the server holds
  // and the screen does not cannot be tested from here.
  const testable = config !== null && hasSecret(config);

  const patch = (p: Partial<ConfigDraft>) => setDraft((d) => ({ ...d, ...p }));

  const test = useMutation({
    mutationFn: (config: AlertingChannelConfig) =>
      testAlertingChannel({ data: { config } }),
    onSuccess: (r, config) =>
      setTested({
        config: JSON.stringify(config),
        ok: r.ok,
        latencyMs: r.latency_ms,
        ...(r.error === undefined ? {} : { error: r.error }),
      }),
    onError: (e: Error, config) =>
      setTested({
        config: JSON.stringify(config),
        ok: false,
        latencyMs: 0,
        error: e.message,
      }),
  });
  const result = tested?.config === JSON.stringify(config) ? tested : null;
  const busy = pending || test.isPending;

  if (editing && confirmingDelete) {
    return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {editing.name}?</DialogTitle>
          <DialogDescription>
            {inDefault ? "It drops out of the default destination. " : ""}A rule
            naming it directly keeps the name and delivers nothing until a
            channel with that name exists again. Past notifications keep its
            name in their record.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setConfirmingDelete(false)}
          >
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            aria-busy={pending}
            onClick={() => onDelete(editing.name)}
          >
            Delete channel
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit channel" : "New channel"}</DialogTitle>
        <DialogDescription>
          A channel is a named endpoint alerts deliver to. Its secret is
          write-only:{" "}
          {editing
            ? "leave the field blank to keep the stored one."
            : "it is never shown again after saving."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="channel-name">Name</Label>
          <Input
            id="channel-name"
            value={name}
            disabled={busy}
            aria-invalid={duplicate ? true : undefined}
            onChange={(e) => setName(e.target.value)}
            placeholder="#oncall"
          />
          {duplicate && (
            <p className="text-destructive text-xs" role="alert">
              A channel with this name already exists.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="channel-type">Type</Label>
          <OptionCombobox
            id="channel-type"
            value={draft.type}
            disabled={busy}
            onChange={(v) => patch({ type: v as ChannelType })}
            options={CHANNEL_TYPES.map((t) => ({
              value: t,
              label: CHANNEL_LABEL[t],
              icon: CHANNEL_ICON[t],
            }))}
          />
        </div>
        {urlField && (
          <div className="space-y-1.5">
            <Label htmlFor="channel-url">{urlField.label}</Label>
            <Input
              id="channel-url"
              type="url"
              className="font-mono"
              value={draft.url}
              disabled={busy}
              onChange={(e) => patch({ url: e.target.value })}
              placeholder={keepsSecret ? "unchanged" : urlField.placeholder}
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
                disabled={busy}
                onChange={(e) => patch({ botToken: e.target.value })}
                placeholder={keepsSecret ? "unchanged" : "123456789:ABC..."}
              />
            </div>
            <div className="space-y-1.5">
              {/* Not a <label>: the tags input has no one control to point
                  at, and carries its own accessible name. */}
              <span className="text-xs/relaxed leading-none font-medium">
                Chat IDs
              </span>
              <TagsInput
                aria-label="Chat IDs"
                placeholder="-1001234567890"
                value={draft.chatIds}
                onValueChange={(chatIds) => patch({ chatIds })}
              />
            </div>
          </>
        )}
        {result && (
          <p
            role={result.ok ? "status" : "alert"}
            className={cn(
              "font-mono text-xs",
              result.ok ? "text-chart-2" : "text-destructive",
            )}
          >
            {result.ok
              ? `Delivered in ${result.latencyMs}ms`
              : `Not delivered: ${result.error ?? "unknown error"}`}
          </p>
        )}
      </div>

      <DialogFooter className="sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={!testable || busy}
            onClick={() => config && test.mutate(config)}
          >
            {test.isPending ? "Sending…" : "Send test"}
          </Button>
          {editing && (
            <Button
              variant="ghost"
              disabled={busy}
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!trimmed || duplicate || !config || busy}
            aria-busy={pending}
            onClick={() => config && onSave({ name: trimmed, config })}
          >
            {editing ? "Save channel" : "Create channel"}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}
