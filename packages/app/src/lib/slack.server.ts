import type { SlackMessage } from "@/server/alerts/04-slack";

const SEND_TIMEOUT_MS = 10_000;

// Posts a Block Kit payload to a Slack Incoming Webhook. Slack returns a non-200
// (with a short body like "invalid_payload") on failure, so any non-2xx throws.
export async function sendSlackMessage(webhookUrl: string, message: SlackMessage): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`slack webhook failed: ${response.status} ${body}`);
  }
}
