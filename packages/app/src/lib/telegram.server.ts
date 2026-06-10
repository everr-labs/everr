import { env } from "@/env";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<void> {
  const token = env.EVERR_ALERTS_TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("EVERR_ALERTS_TELEGRAM_BOT_TOKEN is not configured");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(
      `telegram sendMessage failed: ${response.status} ${body}`,
    );
    serverLogger.error("telegram.send.failed", exceptionAttributes(error));
    throw error;
  }
}
