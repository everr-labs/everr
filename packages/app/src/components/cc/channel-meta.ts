// Presentation vocabulary for the engine's channel types (ChannelConfig in
// clickety-clack's domain/channel.rs): display label, icon, and the
// human-scannable target of a config, keyed on the channel type.
import {
  type LucideIcon,
  Mail,
  MessageSquare,
  Send,
  Webhook,
} from "lucide-react";
import type { CcChannelConfig } from "@/data/cc/types";

export type ChannelType = CcChannelConfig["type"];

export const CHANNEL_LABEL: Record<ChannelType, string> = {
  webhook: "Webhook",
  slack: "Slack",
  email: "Email",
  telegram: "Telegram",
};

export const CHANNEL_ICON: Record<ChannelType, LucideIcon> = {
  slack: MessageSquare,
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
