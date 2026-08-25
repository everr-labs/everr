import type { AlertingChannelConfig } from "@/data/alerting/types";
import type { ChannelNotification } from "./message";
import { postJson } from "./outbound";

/**
 * The generic channel: the notification's own shape is the payload, because
 * the receiver is someone else's endpoint and we have no schema to target.
 * Unlike the branded channels, nothing here is composed to a text limit; a
 * caller's own service decides what to do with the fields.
 */
export function sendWebhookNotification(
  config: Extract<AlertingChannelConfig, { type: "webhook" }>,
  notification: ChannelNotification,
): Promise<void> {
  return postJson(config.url, notification);
}
