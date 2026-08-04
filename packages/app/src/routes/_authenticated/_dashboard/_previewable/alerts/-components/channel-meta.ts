// Mirrors the engine's channel types (ChannelConfig in clickety-clack's
// domain/channel.rs).
import { Mail, Send, Webhook } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
// Slack's brand mark; its colors are intentional and ignore currentColor.
import SlackIcon from "@/assets/slack.svg?react";
import type { CcChannelConfig } from "@/data/cc/types";

export type ChannelType = CcChannelConfig["type"];

/** Lucide icons and hand-inlined brand marks alike: an svg taking svg props. */
export type ChannelIcon = ComponentType<SVGProps<SVGSVGElement>>;

export const CHANNEL_LABEL: Record<ChannelType, string> = {
  webhook: "Webhook",
  slack: "Slack",
  email: "Email",
  telegram: "Telegram",
};

export const CHANNEL_ICON: Record<ChannelType, ChannelIcon> = {
  slack: SlackIcon,
  webhook: Webhook,
  email: Mail,
  telegram: Send,
};

/** The endpoint a channel config points at (URL, routing key, recipients). */
export function channelTarget(c: CcChannelConfig): string {
  switch (c.type) {
    case "slack":
    case "webhook":
      return c.url ?? "";
    case "email":
      return (c.to ?? []).join(", ");
    case "telegram":
      return (c.chat_ids ?? []).join(", ");
  }
}
