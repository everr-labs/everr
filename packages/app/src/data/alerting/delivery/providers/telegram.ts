import type { AlertingChannelConfig } from "@/data/alerting/types";
import { truncateWithEllipsis } from "@/lib/truncate";
import { CHANNEL_TEXT_MAX } from "../channel-text-limits";
import { type ChannelNotification, composeText } from "./message";
import { SEND_TIMEOUT_MS } from "./outbound";

// Alert messages are deliberately plain text: no parse_mode and no inline
// buttons means Telegram has nothing to validate or reject (HTML entities,
// non-public button URLs), so a send only fails for real delivery problems.
//
// Like Slack, this throws a plain Error rather than a `ChannelSendError`, so
// its failures always read as transient to the send job. See the note in
// slack.ts.
async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  const token = botToken.trim();
  if (!token) {
    throw new Error("Telegram bot token is not configured");
  }

  // A truncated alert beats a dropped one. The caller composes to the same
  // limit; this is the belt, so a future caller that forgets cannot produce a
  // send Telegram rejects outright.
  const bounded = truncateWithEllipsis(text, CHANNEL_TEXT_MAX.telegram);

  // The endpoint is ours, not the channel's, so this is the one provider that
  // needs no outbound-URL guard: no user input reaches the host.
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: bounded }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`telegram sendMessage failed: ${response.status} ${body}`);
  }
}

/**
 * One channel fans out to every chat id it carries. The sends run together and
 * the first rejection fails the delivery, so a partial success is retried as a
 * whole; per-recipient state upstream is what keeps an already-delivered chat
 * from being told twice.
 */
export async function sendTelegramNotification(
  config: Extract<AlertingChannelConfig, { type: "telegram" }>,
  notification: ChannelNotification,
): Promise<void> {
  const text = composeText(notification, CHANNEL_TEXT_MAX.telegram);
  await Promise.all(
    config.chat_ids.map((chatId) =>
      sendTelegramMessage(config.bot_token, chatId, text),
    ),
  );
}
