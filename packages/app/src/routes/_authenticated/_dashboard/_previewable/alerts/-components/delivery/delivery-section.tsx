import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@everr/ui/components/alert-dialog";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from "@everr/ui/components/card";
import { Label } from "@everr/ui/components/label";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { AlertingDefaultTier } from "@/data/alerting/delivery/defaults";
import { deliveryQueries } from "@/data/alerting/delivery/queries";
import { setAlertingDefaultDestination } from "@/data/alerting/delivery/server";
import type {
  AlertingChannel,
  AlertingDefaultDestination,
} from "@/data/alerting/types";
import { AlertingConceptNote } from "../common/concept-note";
import { AlertingDrawer } from "../common/drawer";
import { alertingErrorMessage } from "../common/query-error";
import { SectionHeading } from "../common/section-heading";
import { CHANNEL_LABEL } from "./channel-meta";
import { SectionBody } from "./section-chrome";

const SEVERITY_TIERS = ["critical", "warning", "info"] as const;
type SeverityTier = (typeof SEVERITY_TIERS)[number];

const TIER_LABEL: Record<AlertingDefaultTier, string> = {
  all: "All alerts",
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

type DestinationDraft = Record<AlertingDefaultTier, string[]>;

function draftFromDestination(
  destination: AlertingDefaultDestination | undefined,
): { split: boolean; draft: DestinationDraft } {
  const tiers = destination?.tiers ?? {};
  const split = SEVERITY_TIERS.some((tier) => tiers[tier] !== undefined);
  return {
    split,
    draft: {
      all: tiers.all ?? [],
      critical: tiers.critical ?? [],
      warning: tiers.warning ?? [],
      info: tiers.info ?? [],
    },
  };
}

function tiersFromDraft(split: boolean, draft: DestinationDraft) {
  if (split)
    return Object.fromEntries(
      SEVERITY_TIERS.filter((tier) => draft[tier].length > 0).map((tier) => [
        tier,
        draft[tier],
      ]),
    );
  return draft.all.length > 0 ? { all: draft.all } : {};
}

function destinationHasChannels(destination: AlertingDefaultDestination) {
  return Object.values(destination.tiers).some(
    (channels) => channels.length > 0,
  );
}

/**
 * Saving an empty selection deletes every default-channel row, so the save
 * that stops all delivery states its cost before it commits.
 */
function ConfirmClearDelivery({
  pending,
  onConfirm,
}: {
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button disabled={pending} />}>
        Save delivery
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop delivering to every channel?</AlertDialogTitle>
          <AlertDialogDescription>
            The default destination keeps no channels. Alerts still fire and
            still reach the history, but nobody is notified unless the rule
            names its own channels.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            aria-busy={pending}
            disabled={pending}
            onClick={onConfirm}
          >
            Save with no channels
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ChannelChecklist({
  tier,
  channels,
  selected,
  onToggle,
}: {
  tier: AlertingDefaultTier;
  channels: AlertingChannel[];
  selected: string[];
  onToggle: (channelName: string) => void;
}) {
  return (
    <ul className="max-h-56 overflow-y-auto rounded-md border">
      {channels.map((c) => (
        <li key={c.name} className="border-b last:border-b-0">
          <label className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-primary"
              checked={selected.includes(c.name)}
              aria-label={`${TIER_LABEL[tier]} channel ${c.name}`}
              onChange={() => onToggle(c.name)}
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
  );
}

function DeliveryEditor({
  open,
  onOpenChange,
  channels,
  destination,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  channels: AlertingChannel[];
  /** Resolved, never pending: a draft seeded from an unread destination
   * saves an empty selection and deletes the live one. */
  destination: AlertingDefaultDestination;
}) {
  const qc = useQueryClient();
  const initial = draftFromDestination(destination);
  const [split, setSplit] = useState(initial.split);
  const [draft, setDraft] = useState<DestinationDraft>(initial.draft);

  const toggle = (tier: AlertingDefaultTier, channelName: string) =>
    setDraft((d) => ({
      ...d,
      [tier]: d[tier].includes(channelName)
        ? d[tier].filter((n) => n !== channelName)
        : [...d[tier], channelName],
    }));

  const tiers = tiersFromDraft(split, draft);
  const clearsDelivery =
    Object.keys(tiers).length === 0 && destinationHasChannels(destination);

  const save = useMutation({
    mutationFn: () => setAlertingDefaultDestination({ data: { tiers } }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: deliveryQueries.defaultDestination().queryKey,
      });
      onOpenChange(false);
      toast.success("Default destination saved");
    },
    onError: (e) => toast.error(alertingErrorMessage(e)),
  });

  return (
    <AlertingDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Edit delivery"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {clearsDelivery ? (
            <ConfirmClearDelivery
              pending={save.isPending}
              onConfirm={() => save.mutate()}
            />
          ) : (
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              Save delivery
            </Button>
          )}
        </>
      }
    >
      <AlertingConceptNote>
        Every alert delivers to the default destination, unless its rule names
        its own channels. Split by severity to send critical alerts one place
        and the rest another.
      </AlertingConceptNote>
      {channels.length === 0 ? (
        <p
          className="rounded-md border border-dashed p-3 text-xs text-muted-foreground"
          role="alert"
        >
          No channels yet. Create one with &ldquo;New channel&rdquo; first; the
          default destination delivers through existing channels.
        </p>
      ) : (
        <>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-primary"
              checked={split}
              onChange={() => setSplit((s) => !s)}
            />
            Split by severity
          </label>
          {split ? (
            SEVERITY_TIERS.map((tier) => (
              <div key={tier} className="space-y-1.5">
                <Label>{TIER_LABEL[tier]}</Label>
                <ChannelChecklist
                  tier={tier}
                  channels={channels}
                  selected={draft[tier]}
                  onToggle={(name) => toggle(tier, name)}
                />
              </div>
            ))
          ) : (
            <div className="space-y-1.5">
              <Label>Channels</Label>
              <ChannelChecklist
                tier="all"
                channels={channels}
                selected={draft.all}
                onToggle={(name) => toggle("all", name)}
              />
            </div>
          )}
        </>
      )}
    </AlertingDrawer>
  );
}

function DestinationRow({
  tier,
  channels,
}: {
  tier: AlertingDefaultTier;
  channels: string[];
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="w-24 shrink-0 text-sm font-medium">
        {TIER_LABEL[tier]}
      </span>
      <span aria-hidden className="text-muted-foreground/70">
        &rarr;
      </span>
      {channels.length === 0 ? (
        <span className={cn("text-xs", toneText({ tone: "warning" }))}>
          no channels: these alerts are not delivered
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {channels.join(", ")}
        </span>
      )}
    </li>
  );
}

export function DeliverySection({
  channels,
  editing,
  onEditingChange,
}: {
  channels: AlertingChannel[];
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const { data, isPending, isError, error } = useQuery(
    deliveryQueries.defaultDestination(),
  );

  const tiers = data?.tiers ?? {};
  const split =
    tiers.all === undefined &&
    SEVERITY_TIERS.some((tier) => tiers[tier] !== undefined);
  const rows: [AlertingDefaultTier, string[]][] = split
    ? SEVERITY_TIERS.map((tier: SeverityTier) => [tier, tiers[tier] ?? []])
    : [["all", tiers.all ?? []]];

  return (
    <Card id="delivery" inset="flush-content" className="scroll-mt-4">
      <CardHeader>
        <SectionHeading>Delivery</SectionHeading>
        <CardDescription>
          Where alerts go unless a rule names its own channels.
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            className="h-10 sm:h-8"
            disabled={isPending || isError}
            onClick={() => onEditingChange(true)}
          >
            <Pencil data-icon="inline-start" />
            Edit delivery
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <SectionBody
          isError={isError}
          error={error}
          isPending={isPending}
          skeletonRows={1}
          empty={{
            when: !split && (tiers.all ?? []).length === 0,
            icon: Send,
            title: "No default destination",
            hint: "Your first channel becomes the default destination, or pick channels with Edit delivery.",
          }}
        >
          <ul className="divide-y divide-border/60">
            {rows.map(([tier, tierChannels]) => (
              <DestinationRow key={tier} tier={tier} channels={tierChannels} />
            ))}
          </ul>
        </SectionBody>
      </CardContent>
      {/* Remount per open so the draft re-reads the saved destination. */}
      {editing && data && (
        <DeliveryEditor
          open={editing}
          onOpenChange={onEditingChange}
          channels={channels}
          destination={data}
        />
      )}
    </Card>
  );
}
