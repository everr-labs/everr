import type { AlertingChannelConfig } from "@/data/alerting/types";
import { CHANNEL_TEXT_MAX } from "../channel-text-limits";
import { type ChannelNotification, composeText } from "./message";
import { postJson } from "./outbound";

/**
 * Discord's 2000-character content limit is the tightest of the supported
 * channels, which is why the grouped notification body is budgeted against it
 * upstream in the flush. The compose here is the belt, not the budget.
 */
export function sendDiscordNotification(
  config: Extract<AlertingChannelConfig, { type: "discord" }>,
  notification: ChannelNotification,
): Promise<void> {
  return postJson(config.url, {
    content: composeText(notification, CHANNEL_TEXT_MAX.discord),
    // The body is rendered from the rule's annotations against query result
    // values, so any text that reaches the monitored system reaches here: a
    // User-Agent, a URL path, an exception message. Without this an
    // `@everyone` in one of them pings the whole server.
    allowed_mentions: { parse: [] },
  });
}
