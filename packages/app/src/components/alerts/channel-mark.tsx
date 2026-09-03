/**
 * The one place a channel's kind becomes a mark, a word, and a field label.
 * The Notifications list, the channel dialog and the delivery dialog all read
 * from here, so Slack is the same glyph in every one of them.
 */
import { cn } from "@everr/ui/lib/utils";
import type { ComponentType, SVGProps } from "react";
// Brand marks; Slack's and Telegram's colors are intentional and ignore
// currentColor, the webhook glyph keeps its red accent but follows the text
// color for the rest.
import DiscordIcon from "@/assets/discord.svg?react";
import SlackIcon from "@/assets/slack.svg?react";
import TelegramIcon from "@/assets/telegram.svg?react";
import WebhookIcon from "@/assets/webhook.svg?react";
import type { AlertingChannelConfig } from "@/data/alerting/types";

export type ChannelType = AlertingChannelConfig["type"];

export const CHANNEL_TYPES: ChannelType[] = [
  "slack",
  "discord",
  "webhook",
  "telegram",
];

export const CHANNEL_LABEL: Record<ChannelType, string> = {
  webhook: "Webhook",
  slack: "Slack",
  discord: "Discord",
  telegram: "Telegram",
};

export const CHANNEL_ICON: Record<
  ChannelType,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  slack: SlackIcon,
  discord: DiscordIcon,
  webhook: WebhookIcon,
  telegram: TelegramIcon,
};

/**
 * The URL field for the URL-kind channels; presence here drives the dialog's
 * URL input, so a new webhook-shaped channel type is one entry next to its
 * label and icon.
 */
export const CHANNEL_URL_FIELD: Partial<
  Record<ChannelType, { label: string; placeholder: string }>
> = {
  webhook: { label: "Webhook URL", placeholder: "https://example.com/hook" },
  slack: {
    label: "Incoming webhook URL",
    placeholder: "https://hooks.slack.com/services/...",
  },
  discord: {
    label: "Incoming webhook URL",
    placeholder: "https://discord.com/api/webhooks/...",
  },
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

/** What a redacted config still says: the kind, and for Telegram the chats
 *  it reaches. Never the URL or the token, which the read never returns. */
export function channelDetail(config: AlertingChannelConfig): string {
  if (config.type === "telegram")
    return `Telegram · ${config.chat_ids.join(", ")}`;
  return `${CHANNEL_LABEL[config.type]} · secret saved`;
}
