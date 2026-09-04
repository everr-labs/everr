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
import { SecretInput } from "@everr/ui/components/secret-input";
import { TagsInput } from "@everr/ui/components/tags-input";
import { cn } from "@everr/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  type ChannelConfigDraft,
  type ChannelType,
  channelConfigDraft,
  channelConfigInput,
  EMPTY_CHANNEL_DRAFT,
} from "@/data/alerting/delivery/channel-input";
import { testAlertingChannel } from "@/data/alerting/delivery/server";
import type { NotificationChannelView } from "@/data/alerting/delivery/view";
import type { AlertingChannelConfigInput } from "@/data/alerting/types";
import { CHANNEL_OPTIONS, CHANNEL_URL_FIELD } from "./channel-mark";

/** What the dialog is open on: a channel to make, seeded with a name when a
 *  gap row asked for one, or a channel to change. `null` while closed. */
export type ChannelTarget =
  | { mode: "new"; name: string }
  | { mode: "edit"; channel: NotificationChannelView };

/** What the dialog hands back on save. On a same-type edit, a secret left
 *  blank is omitted so the server can retain the stored one. */
export type ChannelDraft = {
  name: string;
  config: AlertingChannelConfigInput;
};

export function ChannelDialog({
  target,
  channels,
  pending,
  onClose,
  onSave,
  onDelete,
}: {
  target: ChannelTarget | null;
  /** Every channel the org has, for the duplicate-name check. */
  channels: NotificationChannelView[];
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
          existingNames={channels.map((c) => c.name)}
          pending={pending}
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
  pending,
  onSave,
  onDelete,
}: {
  target: ChannelTarget;
  existingNames: string[];
  pending: boolean;
  onSave: (draft: ChannelDraft) => void;
  onDelete: (name: string) => void;
}) {
  const editing = target.mode === "edit" ? target.channel : null;
  const [name, setName] = useState(
    target.mode === "new" ? target.name : target.channel.name,
  );
  const [draft, setDraft] = useState<ChannelConfigDraft>(() =>
    editing ? channelConfigDraft(editing.config) : EMPTY_CHANNEL_DRAFT,
  );
  // Deleting asks first, in place: a second dialog stacked on this one is
  // dismissed by the first as an outside press.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const trimmed = name.trim();
  const duplicate =
    existingNames.includes(trimmed) && trimmed !== editing?.name;
  const config = channelConfigInput(draft, editing?.config.type ?? null);
  // On an edit of the stored kind, the secret starts behind an explicit Edit
  // action. A blank draft still means keep the stored secret.
  const keepsSecret = editing !== null && editing.config.type === draft.type;
  const urlField = CHANNEL_URL_FIELD[draft.type];
  const testable = config !== null;

  const patch = (p: Partial<ChannelConfigDraft>) =>
    setDraft((d) => ({ ...d, ...p }));

  const test = useMutation({
    mutationFn: (config: AlertingChannelConfigInput) =>
      testAlertingChannel({
        data: {
          config,
          source: editing
            ? { kind: "saved", name: editing.name }
            : { kind: "new" },
        },
      }),
  });
  // The result is shown only while the config it tested is still the one on
  // screen: a verdict on an endpoint the reader has since retyped is worse
  // than none.
  const tested =
    !test.isPending &&
    test.variables !== undefined &&
    JSON.stringify(test.variables) === JSON.stringify(config);
  const busy = pending || test.isPending;

  if (editing && confirmingDelete) {
    return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {editing.name}?</DialogTitle>
          <DialogDescription>
            {editing.tiers.length > 0
              ? "It drops out of the default destination. "
              : ""}
            A rule naming it directly keeps the name and delivers nothing until
            a channel with that name exists again. Past notifications keep its
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
          A channel is a named endpoint alerts deliver to. Secrets are
          write-only and never shown again after saving.
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
            options={CHANNEL_OPTIONS}
          />
        </div>
        {urlField && (
          <div className="space-y-1.5">
            <Label htmlFor="channel-url">{urlField.label}</Label>
            <SecretInput
              key={draft.type}
              id="channel-url"
              type="url"
              className="font-mono"
              value={draft.url}
              disabled={busy}
              hasStoredSecret={keepsSecret}
              onValueChange={(url) => patch({ url })}
              placeholder={urlField.placeholder}
            />
          </div>
        )}
        {draft.type === "telegram" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="channel-bot-token">Bot token</Label>
              <SecretInput
                key={draft.type}
                id="channel-bot-token"
                className="font-mono"
                value={draft.botToken}
                disabled={busy}
                hasStoredSecret={keepsSecret}
                onValueChange={(botToken) => patch({ botToken })}
                placeholder="123456789:ABC..."
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
        {tested && (
          <p
            role={test.data?.ok ? "status" : "alert"}
            className={cn(
              "font-mono text-xs",
              test.data?.ok ? "text-chart-2" : "text-destructive",
            )}
          >
            {test.data?.ok
              ? `Delivered in ${test.data.latency_ms}ms`
              : `Not delivered: ${test.data?.error ?? test.error?.message ?? "unknown error"}`}
          </p>
        )}
      </div>

      <DialogFooter className="flex-row flex-wrap items-center justify-start sm:justify-start">
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
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            disabled={!testable || busy}
            onClick={() => config && test.mutate(config)}
          >
            {test.isPending ? "Sending…" : "Send test"}
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
