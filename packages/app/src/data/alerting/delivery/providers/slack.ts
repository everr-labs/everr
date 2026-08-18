import type { AlertingChannelConfig } from "@/data/alerting/types";
import { CHANNEL_TEXT_MAX } from "../channel-text-limits";
import { type ChannelNotification, composeText } from "./message";
import {
  ChannelSendError,
  isPermanentStatus,
  SEND_TIMEOUT_MS,
  validateOutboundUrl,
} from "./outbound";

/**
 * Slack reads a `mrkdwn` block as markup, so the three characters that start
 * markup are escaped before the body becomes one. The body is rendered from
 * the rule's annotations against query result values, so any text that
 * reaches the monitored system reaches here: without this, `<!channel>` in a
 * log line pings the channel, and `<https://evil.example|Open the alert>`
 * renders as a trusted-looking link. Slack's own escaping rule, and the
 * ampersand has to go first or it re-escapes the others.
 *
 * Applied to the fields before they are composed, not to the finished text:
 * an entity is five characters where the source was one, so escaping after
 * the fit would push the message back over Slack's limit. The url is left
 * alone; it is ours, and an escaped ampersand would break the link.
 */
function escapeSlackMarkup(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Posts a Block Kit attachment to a Slack Incoming Webhook.
 *
 * Slack does not accept the plain JSON body `postJson` sends, so this builds
 * its own request; the outbound URL still passes the same guard first, and the
 * failure is classified the same way, so a revoked webhook stops on its first
 * 4xx instead of spending the delivery's whole retry budget.
 */
export async function sendSlackNotification(
  config: Extract<AlertingChannelConfig, { type: "slack" }>,
  notification: ChannelNotification,
): Promise<void> {
  const url = await validateOutboundUrl(config.url);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      attachments: [
        {
          color: "#dc2626",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: composeText(
                  {
                    ...notification,
                    title: escapeSlackMarkup(notification.title),
                    body: escapeSlackMarkup(notification.body),
                  },
                  CHANNEL_TEXT_MAX.slack,
                ),
              },
            },
          ],
        },
      ],
    }),
    redirect: "error",
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  // Slack answers a bad request with a non-200 and a short body such as
  // "invalid_payload", so any non-2xx is the failure signal.
  if (!response.ok) {
    throw new ChannelSendError(`slack webhook failed: ${response.status}`, {
      permanent: isPermanentStatus(response.status),
      status: response.status,
      responseBody: await response.text().catch(() => ""),
    });
  }
}
