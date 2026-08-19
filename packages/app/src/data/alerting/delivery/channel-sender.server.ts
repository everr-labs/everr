import type { AlertingChannelConfig } from "@/data/alerting/types";
import { sendDiscordNotification } from "./providers/discord";
import type { ChannelNotification } from "./providers/message";
import { sendSlackNotification } from "./providers/slack";
import { sendTelegramNotification } from "./providers/telegram";
import { sendWebhookNotification } from "./providers/webhook";

// Re-exported so a caller that sends keeps one import: the send job needs the
// error type to classify a failure.
export { ChannelSendError } from "./providers/outbound";

/**
 * The one place a channel type turns into a send. Each provider under
 * `providers/` owns its whole channel: the payload shape, the limit it
 * composes to, and how its failures are reported. Adding a channel type means
 * adding a file there and a case here, and the exhaustive switch turns a
 * forgotten case into a compile error.
 */
export async function sendChannelNotification(
  config: AlertingChannelConfig,
  notification: ChannelNotification,
): Promise<void> {
  switch (config.type) {
    case "webhook":
      return sendWebhookNotification(config, notification);
    case "slack":
      return sendSlackNotification(config, notification);
    case "discord":
      return sendDiscordNotification(config, notification);
    case "telegram":
      return sendTelegramNotification(config, notification);
  }
}

export function sendChannelTest(config: AlertingChannelConfig): Promise<void> {
  return sendChannelNotification(config, {
    title: "Everr test notification",
    body: "This channel is configured correctly.",
  });
}
