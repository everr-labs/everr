import type { AlertingChannelConfig } from "@/data/alerting/types";
import { truncateWithEllipsis } from "@/lib/truncate";
import { CHANNEL_TEXT_MAX } from "../channel-text-limits";
import { type ChannelNotification, composeText } from "./message";
import {
  ChannelSendError,
  isPermanentStatus,
  SEND_TIMEOUT_MS,
} from "./outbound";

// Alert messages are deliberately plain text: no parse_mode and no inline
// buttons means Telegram has nothing to validate or reject (HTML entities,
// non-public button URLs), so a send only fails for real delivery problems.
async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  const token = botToken.trim();
  if (!token) {
    // No retry can supply a token the channel does not hold.
    throw new ChannelSendError("Telegram bot token is not configured", {
      permanent: true,
    });
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
    throw new ChannelSendError(
      `telegram sendMessage failed: ${response.status} ${body}`,
      { permanent: isPermanentStatus(response.status) },
    );
  }
}

/**
 * One channel fans out to every chat id it carries.
 *
 * The verdicts are collected rather than raced. `Promise.all` would surface
 * whichever recipient rejected first and let its verdict stand for the whole
 * delivery, so one chat that blocked the bot could end a delivery that another
 * chat behind a 5xx would have accepted on the next attempt. A fan-out is
 * permanently failed only when no retry could help any recipient.
 *
 * A retry still re-sends to recipients that already succeeded; per-recipient
 * state is ticket 23, and nothing here closes it. The failure count is
 * reported, but never which chats: chat ids are addresses, and the error text
 * is appended to the history row.
 */
export async function sendTelegramNotification(
  config: Extract<AlertingChannelConfig, { type: "telegram" }>,
  notification: ChannelNotification,
): Promise<void> {
  const text = composeText(notification, CHANNEL_TEXT_MAX.telegram);
  const results = await Promise.allSettled(
    config.chat_ids.map((chatId) =>
      sendTelegramMessage(config.bot_token, chatId, text),
    ),
  );
  const failures = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason as unknown);
  if (failures.length === 0) return;

  const permanent = failures.every(
    (reason) => reason instanceof ChannelSendError && reason.permanent,
  );
  const detail =
    failures[0] instanceof Error ? failures[0].message : String(failures[0]);
  throw new ChannelSendError(
    `telegram delivery failed for ${failures.length} of ${config.chat_ids.length} chats: ${detail}`,
    { permanent },
  );
}
