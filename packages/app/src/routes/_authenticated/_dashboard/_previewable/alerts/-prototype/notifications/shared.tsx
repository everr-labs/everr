/**
 * PROTOTYPE. What the three variants share: the channel's mark and label,
 * and the words for a delivery record. Layout is deliberately not shared.
 */
import { cn } from "@everr/ui/lib/utils";
import type { ComponentType, SVGProps } from "react";
import DiscordIcon from "@/assets/discord.svg?react";
import SlackIcon from "@/assets/slack.svg?react";
import TelegramIcon from "@/assets/telegram.svg?react";
import WebhookIcon from "@/assets/webhook.svg?react";
import { formatElapsed } from "@/data/alerting/triage/format";
import type {
  AlertingChannelConfig,
  AlertingSeverity,
} from "@/data/alerting/types";
import { CHANNELS, type Channel, type DeliveryRecord } from "./fixtures";

type ChannelType = AlertingChannelConfig["type"];

const CHANNEL_LABEL: Record<ChannelType, string> = {
  webhook: "Webhook",
  slack: "Slack",
  discord: "Discord",
  telegram: "Telegram",
};

const CHANNEL_ICON: Record<
  ChannelType,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  slack: SlackIcon,
  discord: DiscordIcon,
  webhook: WebhookIcon,
  telegram: TelegramIcon,
};

export const SEVERITY_LABEL: Record<AlertingSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

export const SEVERITY_DOT: Record<AlertingSeverity, string> = {
  critical: "bg-destructive",
  warning: "bg-chart-2",
  info: "bg-muted-foreground",
};

/** The brand mark in a muted tile, the size the lists use for a row glyph. */
export function ChannelMark({
  type,
  size = "md",
  className,
}: {
  type: ChannelType;
  size?: "sm" | "md";
  className?: string;
}) {
  const Icon = CHANNEL_ICON[type];
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
        size === "md" ? "size-7 [&>svg]:size-4" : "size-5 [&>svg]:size-3",
        className,
      )}
    >
      <Icon />
    </span>
  );
}

/** The channel a name resolves to, or a stand-in for a name no channel has:
 *  a rule can keep naming a channel after it was deleted. */
export function channelByNameOrMissing(
  name: string,
): Channel & { missing: boolean } {
  const channel = CHANNELS.find((c) => c.name === name);
  if (channel) return { ...channel, missing: false };
  return {
    name,
    config: { type: "webhook", url: "" },
    createdAt: new Date(0),
    missing: true,
  };
}

/** What the config exposes without its secret: the kind, and for Telegram
 *  the chats it reaches. */
export function channelDetail(channel: Channel): string {
  const { config } = channel;
  if (config.type === "telegram")
    return `Telegram · ${config.chat_ids.join(", ")}`;
  return `${CHANNEL_LABEL[config.type]} · secret saved`;
}

export function agoText(at: Date | null, now: number): string | null {
  if (!at) return null;
  return `${formatElapsed(now - at.getTime())} ago`;
}

/** The record as one inline phrase, failures in the destructive tone. */
export function DeliveryPhrase({
  record,
  now,
  className,
}: {
  record: DeliveryRecord | undefined;
  now: number;
  className?: string;
}) {
  if (!record || (record.sent === 0 && record.failed === 0)) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        nothing sent
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-baseline gap-x-1.5",
        className,
      )}
    >
      <span className="tabular-nums">{record.sent} sent</span>
      {record.failed > 0 && (
        <span className="text-destructive tabular-nums">
          {record.failed} failed
        </span>
      )}
      <span className="text-muted-foreground">
        {agoText(record.lastSentAt, now)}
      </span>
    </span>
  );
}
