import { z } from "zod";
import { validateTelegramBotToken, validateTelegramChatId } from "./recipients";

// Single definition of the notification channels. Adding a channel means
// extending this array, the schema below, and the per-channel send logic in
// server/alerts/delivery.ts.
export const ALERT_CHANNELS = ["telegram"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];
export type AlertDeliveryTargets = Partial<Record<AlertChannel, string[]>>;

// The "enabled channels need at least one recipient" rule, stated once and
// consumed by both the server schema below and the settings form's inline
// field validation.
const EMPTY_CHANNEL_MESSAGES: Record<AlertChannel, string> = {
  telegram: "Telegram is enabled but has no chat IDs",
};

const MISSING_TELEGRAM_BOT_TOKEN_MESSAGE =
  "Telegram is enabled but has no bot token";

export function emptyChannelError(
  channel: AlertChannel,
  enabled: boolean,
  recipients: readonly string[],
): string | undefined {
  return enabled && recipients.length === 0
    ? EMPTY_CHANNEL_MESSAGES[channel]
    : undefined;
}

export function telegramBotTokenError(
  enabled: boolean,
  botToken: string,
): string | undefined {
  return enabled && validateTelegramBotToken(botToken) !== null
    ? MISSING_TELEGRAM_BOT_TOKEN_MESSAGE
    : undefined;
}

export const DeliverySettingsSchema = z
  .object({
    telegram: z
      .object({
        enabled: z.boolean(),
        botToken: z.string().trim().default(""),
        chatIds: z
          .array(
            z
              .string()
              .refine((value) => validateTelegramChatId(value) === null, {
                message: "Invalid Telegram chat ID",
              }),
          )
          .max(50)
          .default([]),
      })
      .strict()
      .refine(
        (value) => !emptyChannelError("telegram", value.enabled, value.chatIds),
        { message: EMPTY_CHANNEL_MESSAGES.telegram },
      )
      .refine(
        (value) => !telegramBotTokenError(value.enabled, value.botToken),
        { message: MISSING_TELEGRAM_BOT_TOKEN_MESSAGE },
      )
      .optional(),
  })
  .strict();

export type AlertDeliverySettings = z.infer<typeof DeliverySettingsSchema>;

export type NormalizedAlertDeliverySettings = {
  telegram: { enabled: boolean; botToken: string; chatIds: string[] };
};

export function normalizeDeliverySettings(
  delivery: AlertDeliverySettings | null | undefined,
): NormalizedAlertDeliverySettings {
  return {
    telegram: {
      enabled: delivery?.telegram?.enabled ?? false,
      botToken: delivery?.telegram?.botToken?.trim() ?? "",
      chatIds: delivery?.telegram?.chatIds ?? [],
    },
  };
}
