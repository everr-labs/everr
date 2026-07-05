import { truncateWithEllipsis } from "@/lib/truncate";

// Telegram rejects messages longer than this outright.
const MAX_TEXT_LENGTH = 4096;
const SEND_TIMEOUT_MS = 10_000;

// Alert messages are deliberately plain text: no parse_mode and no inline
// buttons means Telegram has nothing to validate or reject (HTML entities,
// non-public button URLs), so a send only fails for real delivery problems.
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  const token = botToken.trim();
  if (!token) {
    throw new Error("Telegram bot token is not configured");
  }

  // A truncated alert beats a dropped one.
  const bounded = truncateWithEllipsis(text, MAX_TEXT_LENGTH);

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: bounded }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`telegram sendMessage failed: ${response.status} ${body}`);
  }
}
