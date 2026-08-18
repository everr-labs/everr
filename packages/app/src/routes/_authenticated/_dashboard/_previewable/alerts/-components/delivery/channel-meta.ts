// Channel metadata shared by delivery configuration surfaces.
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

/** Lucide icons and hand-inlined brand marks alike: an svg taking svg props. */
export type ChannelIcon = ComponentType<SVGProps<SVGSVGElement>>;

export const CHANNEL_LABEL: Record<ChannelType, string> = {
  webhook: "Webhook",
  slack: "Slack",
  discord: "Discord",
  telegram: "Telegram",
};

export const CHANNEL_ICON: Record<ChannelType, ChannelIcon> = {
  slack: SlackIcon,
  discord: DiscordIcon,
  webhook: WebhookIcon,
  telegram: TelegramIcon,
};

/**
 * The URL field for the URL-kind channels; presence here drives the builder's
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

/** The endpoint a channel config points at (URL, or Telegram chat ids). */
export function channelTarget(c: AlertingChannelConfig): string {
  switch (c.type) {
    case "slack":
    case "discord":
    case "webhook":
      return c.url ?? "";
    case "telegram":
      return (c.chat_ids ?? []).join(", ");
  }
}
