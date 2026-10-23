import type { AlertingChannelConfig } from "#app/data/alerting/types.ts";
import { truncateWithEllipsis } from "#app/lib/truncate.ts";
import { CHANNEL_TEXT_MAX } from "../channel-text-limits";
import { type ChannelNotification, composeText } from "./message";
import { ChannelSendError, postOutbound } from "./outbound";

// Alert messages are deliberately plain text. With no parse_mode and no
// inline buttons, Telegram has nothing to validate or reject, so a send fails
// only for a real delivery problem.
async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<void> {
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
  // needs no outbound-URL guard: no user input reaches the host. The token
  // is in the URL, so a failure must not repeat that URL.
  await postOutbound(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: bounded }),
    },
    "telegram sendMessage",
  );
}

/**
 * One channel fans out to every chat id it carries.
 *
 * The verdicts are collected, not raced. `Promise.all` would let whichever
 * recipient rejected first stand for the whole delivery, so one chat that
 * blocked the bot could end a delivery another chat would accept on the next
 * attempt. A fan-out fails permanently only when no retry could help any
 * recipient.
 *
 * A retry still re-sends to recipients that already succeeded: there is no
 * per-recipient delivery state. The failure count is reported, never which
 * chats, because chat ids are addresses and the error text reaches the
 * history row.
 */
export async function sendTelegramNotification(
  config: Extract<AlertingChannelConfig, { type: "telegram" }>,
  notification: ChannelNotification,
): Promise<void> {
  const text = composeText(notification, CHANNEL_TEXT_MAX.telegram);
  const results = await Promise.allSettled(
    config.chat_ids.map((chatId) => sendTelegramMessage(config.bot_token, chatId, text)),
  );
  const failures = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length === 0) return;

  const permanent = failures.every(
    (reason) => reason instanceof ChannelSendError && reason.permanent,
  );
  const first = failures[0];
  // Only a message we wrote. An unknown rejection can quote the request URL,
  // and the bot token is in that URL.
  const detail =
    first instanceof ChannelSendError ? first.message : "telegram sendMessage failed: network";
  throw new ChannelSendError(
    `telegram delivery failed for ${failures.length} of ${config.chat_ids.length} chats: ${detail}`,
    { permanent },
  );
}
