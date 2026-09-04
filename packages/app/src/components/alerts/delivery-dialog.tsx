import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Label } from "@everr/ui/components/label";
import { Switch } from "@everr/ui/components/switch";
import { cn } from "@everr/ui/lib/utils";
import { useState } from "react";
import {
  ALERTING_SEVERITY_TIERS,
  type AlertingDefaultTier,
} from "@/data/alerting/delivery/defaults";
import type {
  NotificationChannelView,
  NotificationDestinationView,
} from "@/data/alerting/delivery/view";
import type { AlertingDefaultDestination } from "@/data/alerting/types";
import { SEVERITY_DOT, TIER_LABEL } from "./alert-status";
import { CHANNEL_LABEL, ChannelMark } from "./channel-mark";

/** The draft as the write takes it: only the tiers of the mode in force,
 *  and only the ones with channels. */
function tiersFromDraft(
  split: boolean,
  draft: NotificationDestinationView["tiers"],
): AlertingDefaultDestination["tiers"] {
  if (split)
    return Object.fromEntries(
      ALERTING_SEVERITY_TIERS.filter((tier) => draft[tier].length > 0).map(
        (tier) => [tier, draft[tier]],
      ),
    );
  return draft.all.length > 0 ? { all: draft.all } : {};
}

function ChannelChecklist({
  tier,
  channels,
  selected,
  disabled,
  onToggle,
}: {
  tier: AlertingDefaultTier;
  channels: NotificationChannelView[];
  selected: string[];
  disabled: boolean;
  onToggle: (name: string) => void;
}) {
  return (
    <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
      {channels.map((channel) => (
        <li key={channel.name}>
          <label className="flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-2 text-sm hover:bg-muted/50">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-primary"
              checked={selected.includes(channel.name)}
              disabled={disabled}
              aria-label={`${TIER_LABEL[tier]} to ${channel.name}`}
              onChange={() => onToggle(channel.name)}
            />
            <ChannelMark type={channel.config.type} size="sm" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">
              {channel.name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {CHANNEL_LABEL[channel.config.type]}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * Where every alert goes unless its rule says otherwise. One list for all
 * alerts, or one per severity once split. Saving an empty selection stops
 * all default delivery, so that save states its cost before it commits.
 */
export function DeliveryDialog({
  open,
  channels,
  destination,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  channels: NotificationChannelView[];
  destination: NotificationDestinationView;
  /** The write is in flight; the dialog stays open and inert until it lands. */
  pending: boolean;
  onClose: () => void;
  onConfirm: (draft: AlertingDefaultDestination) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      {open && (
        // Remounted per opening, so the draft re-reads the saved destination.
        <DeliveryForm
          channels={channels}
          destination={destination}
          pending={pending}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      )}
    </Dialog>
  );
}

function DeliveryForm({
  channels,
  destination,
  pending,
  onClose,
  onConfirm,
}: {
  channels: NotificationChannelView[];
  destination: NotificationDestinationView;
  pending: boolean;
  onClose: () => void;
  onConfirm: (draft: AlertingDefaultDestination) => void;
}) {
  const [split, setSplit] = useState(destination.split);
  const [draft, setDraft] = useState(destination.tiers);
  // The save that stops all delivery asks first, in place: a second dialog
  // stacked on this one is dismissed by the first as an outside press.
  const [confirmingClear, setConfirmingClear] = useState(false);

  const toggle = (tier: AlertingDefaultTier, name: string) =>
    setDraft((d) => ({
      ...d,
      [tier]: d[tier].includes(name)
        ? d[tier].filter((n) => n !== name)
        : [...d[tier], name],
    }));

  const tiers = tiersFromDraft(split, draft);
  const hadChannels = Object.values(destination.tiers).some(
    (names) => names.length > 0,
  );
  const clearsDelivery = Object.keys(tiers).length === 0 && hadChannels;
  const save = () => onConfirm({ tiers });

  const checklist = (tier: AlertingDefaultTier) => (
    <ChannelChecklist
      tier={tier}
      channels={channels}
      selected={draft[tier]}
      disabled={pending}
      onToggle={(name) => toggle(tier, name)}
    />
  );

  if (confirmingClear) {
    return (
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Stop delivering to every channel?</DialogTitle>
          <DialogDescription>
            The default destination keeps no channels. Alerts still fire and
            still reach the history, but nobody is notified unless the rule
            names its own channels.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setConfirmingClear(false)}
          >
            Back
          </Button>
          <Button
            variant="destructive"
            disabled={pending}
            aria-busy={pending}
            onClick={save}
          >
            Save with no channels
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Edit delivery</DialogTitle>
        <DialogDescription>
          Every alert delivers here unless its rule names channels of its own.
          Split by severity to send critical alerts one place and the rest
          another.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <Label className="flex w-fit cursor-pointer items-center gap-2">
          <Switch
            checked={split}
            disabled={pending}
            onCheckedChange={setSplit}
          />
          Split by severity
        </Label>
        {split ? (
          ALERTING_SEVERITY_TIERS.map((tier) => (
            <div key={tier} className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <span
                  className={cn("size-1.5 rounded-full", SEVERITY_DOT[tier])}
                />
                {TIER_LABEL[tier]}
              </div>
              {checklist(tier)}
            </div>
          ))
        ) : (
          <div className="space-y-1.5">
            <div className="text-sm font-medium">{TIER_LABEL.all}</div>
            {checklist("all")}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={pending}
          aria-busy={pending}
          onClick={clearsDelivery ? () => setConfirmingClear(true) : save}
        >
          Save delivery
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
