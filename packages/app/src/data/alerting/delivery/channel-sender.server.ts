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
 */
export async function sendChannelNotification(
  config: AlertingChannelConfig,
  notification: ChannelNotification,
): Promise<void> {
  try {
    switch (config.type) {
      case "webhook":
        await sendWebhookNotification(config, notification);
        return;
      case "slack":
        await sendSlackNotification(config, notification);
        return;
      case "discord":
        await sendDiscordNotification(config, notification);
        return;
      case "telegram":
        await sendTelegramNotification(config, notification);
        return;
    }
  } catch (cause) {
    // The config is in hand here, so a caller never has to remember that an
    // endpoint can echo a header value, a URL, or a bot token back. Anything
    // this function throws has those secrets removed from its message and,
    // for a send failure, from the endpoint's answer.
    throw scrubChannelSecrets(cause, secretsIn(config));
  }
}

/** Secrets a config holds that have no shape of their own to match later.
 *  Header names and Telegram chat ids stay: readers need them. */
function secretsIn(config: AlertingChannelConfig): string[] {
  switch (config.type) {
    case "webhook":
      return [config.url, ...(config.headers ?? []).map((header) => header.value)];
    case "slack":
    case "discord":
      return [config.url];
    case "telegram":
      return [config.bot_token];
  }
}

function redactSecrets(text: string, secrets: readonly string[]): string {
  // Longer secrets go first so a short one that is a prefix of a longer one
  // cannot punch a hole in it. An empty string matches every position.
  const unique = [...new Set(secrets.filter((secret) => secret.length > 0))];
  unique.sort((a, b) => b.length - a.length);
  let redacted = text;
  for (const secret of unique) {
    redacted = redacted.replaceAll(secret, "[redacted-secret]");
  }
  return redacted;
}

function scrubChannelSecrets(cause: unknown, secrets: readonly string[]): unknown {
  if (cause instanceof ChannelSendError) {
    return new ChannelSendError(redactSecrets(cause.message, secrets), {
      permanent: cause.permanent,
      status: cause.status,
      responseBody:
        cause.responseBody === undefined ? undefined : redactSecrets(cause.responseBody, secrets),
    });
  }
  if (cause instanceof Error) {
    const scrubbed = new Error(redactSecrets(cause.message, secrets));
    scrubbed.name = cause.name;
    return scrubbed;
  }
  return cause;
}

export function sendChannelTest(config: AlertingChannelConfig): Promise<void> {
  return sendChannelNotification(config, {
    title: "Everr test notification",
    body: "This channel is configured correctly.",
  });
}
