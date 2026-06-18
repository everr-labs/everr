// Numeric chat ID (negative for groups/channels) or a public @username.
const TELEGRAM_CHAT_ID_PATTERN = /^(-?\d+|@[A-Za-z0-9_]{5,32})$/;

export function validateTelegramChatId(value: string): string | null {
  return TELEGRAM_CHAT_ID_PATTERN.test(value)
    ? null
    : `Invalid chat ID: ${value} — use a numeric ID or @username`;
}

export function validateTelegramBotToken(value: string): string | null {
  return value.trim().length > 0 ? null : "Telegram bot token is required";
}
