const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Numeric chat ID (negative for groups/channels) or a public @username.
const TELEGRAM_CHAT_ID_PATTERN = /^(-?\d+|@[A-Za-z0-9_]{5,32})$/;

export function validateEmailRecipient(value: string): string | null {
  return EMAIL_PATTERN.test(value) ? null : `Invalid email: ${value}`;
}

export function validateTelegramChatId(value: string): string | null {
  return TELEGRAM_CHAT_ID_PATTERN.test(value)
    ? null
    : `Invalid chat ID: ${value} — use a numeric ID or @username`;
}

export function validateTelegramBotToken(value: string): string | null {
  return value.trim().length > 0 ? null : "Telegram bot token is required";
}

// Slack Incoming Webhook URL: https://hooks.slack.com/services/T.../B.../secret
const SLACK_WEBHOOK_URL_PATTERN =
  /^https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9_-]+$/;

export function validateSlackWebhookUrl(value: string): string | null {
  return SLACK_WEBHOOK_URL_PATTERN.test(value.trim())
    ? null
    : "Invalid Slack webhook URL — expected https://hooks.slack.com/services/...";
}
