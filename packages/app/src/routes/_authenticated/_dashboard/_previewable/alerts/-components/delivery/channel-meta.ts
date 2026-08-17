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

/** A name that reads right for the type, offered until the reader types one. */
export const CHANNEL_NAME_PLACEHOLDER: Record<ChannelType, string> = {
  slack: "team-slack",
  discord: "team-discord",
  telegram: "oncall-telegram",
  webhook: "ops-webhook",
};

/** What a channel of this type does, in the picker. Five words, not a lesson. */
export const CHANNEL_TAGLINE: Record<ChannelType, string> = {
  slack: "Post to a Slack channel",
  discord: "Post to a Discord channel",
  telegram: "Message a Telegram chat",
  webhook: "POST the alert as JSON",
};

/**
 * Where the value in the form comes from. Shown once, under the field it
 * belongs to: the reader who already has the URL should be able to ignore it.
 */
export const CHANNEL_SOURCE_HINT: Record<
  ChannelType,
  { text: string; href: string; linkLabel: string }
> = {
  slack: {
    text: "Slack app settings, Incoming Webhooks, Add New Webhook to Workspace.",
    href: "https://api.slack.com/messaging/webhooks",
    linkLabel: "Slack webhook guide",
  },
  discord: {
    text: "Discord channel settings, Integrations, Webhooks, Copy Webhook URL.",
    href: "https://support.discord.com/hc/en-us/articles/228383668",
    linkLabel: "Discord webhook guide",
  },
  telegram: {
    text: "@BotFather issues the token; add the bot to the chat to get its id.",
    href: "https://core.telegram.org/bots#how-do-i-create-a-bot",
    linkLabel: "Telegram bot guide",
  },
  webhook: {
    text: "Everr POSTs a JSON body with the alert, its labels, and its status.",
    href: "https://everr.dev/docs/guides/set-up-notifications",
    linkLabel: "Payload reference",
  },
};

/** The endpoint a channel config points at (URL, or Telegram chat ids). */
function channelTarget(c: AlertingChannelConfig): string {
  switch (c.type) {
    case "slack":
    case "discord":
    case "webhook":
      return c.url ?? "";
    case "telegram":
      return (c.chat_ids ?? []).join(", ");
  }
}

/**
 * The endpoint as a reader should see it.
 *
 * Secrets come back from the API as `***`, which reads like a value rather
 * than an absence, so a redacted target says what it is instead. `literal`
 * separates the two for the caller: an address is data and sets in mono, a
 * statement about the address is prose.
 */
export function channelTargetSummary(c: AlertingChannelConfig): {
  text: string;
  literal: boolean;
} {
  const target = channelTarget(c);
  if (target === "" || target === "***") {
    return {
      text: c.type === "telegram" ? "Token stored" : "URL stored",
      literal: false,
    };
  }
  return { text: target, literal: true };
}
