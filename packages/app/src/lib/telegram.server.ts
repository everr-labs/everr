import { env } from "@/env";

// Telegram rejects messages longer than this outright.
const MAX_TEXT_LENGTH = 4096;

// Alert messages are deliberately plain text: no parse_mode and no inline
// buttons means Telegram has nothing to validate or reject (HTML entities,
// non-public button URLs), so a send only fails for real delivery problems.
export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<void> {
  const token = env.EVERR_ALERTS_TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("EVERR_ALERTS_TELEGRAM_BOT_TOKEN is not configured");
  }

  // A truncated alert beats a dropped one.
  const bounded =
    text.length > MAX_TEXT_LENGTH
      ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…`
      : text;

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: bounded }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`telegram sendMessage failed: ${response.status} ${body}`);
  }
}
