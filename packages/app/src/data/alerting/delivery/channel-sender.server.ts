import type { AlertingChannelConfig } from "#app/data/alerting/types.ts";
import { sendDiscordNotification } from "./providers/discord";
import type { ChannelNotification } from "./providers/message";
import { sendSlackNotification } from "./providers/slack";
import { sendTelegramNotification } from "./providers/telegram";
import { ChannelSendError } from "./providers/outbound";
import { sendWebhookNotification } from "./providers/webhook";

// Re-exported so a caller that sends keeps one import: the send job needs the
// error type to classify a failure.
export { ChannelSendError };

/**
 * The one place a channel type turns into a send. Each provider under
 * `providers/` owns its whole channel: the payload shape, the limit it
 * composes to, and how its failures are reported. Adding a channel type means
 * adding a file there and a case here, and the exhaustive switch turns a
 * forgotten case into a compile error.
 *
 * A failure names our outcome. It does not carry the endpoint's answer, the
 * request URL, or a header value: any of those can be a secret, and the text
 * is stored and logged.
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
