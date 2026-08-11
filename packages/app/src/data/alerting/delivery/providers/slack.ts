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
                text: composeText(notification, CHANNEL_TEXT_MAX.slack),
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
    const body = await response.text().catch(() => "");
    throw new ChannelSendError(
      `slack webhook failed: ${response.status} ${body}`,
      { permanent: isPermanentStatus(response.status) },
    );
  }
}
