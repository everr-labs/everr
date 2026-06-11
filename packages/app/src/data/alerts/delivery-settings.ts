import { z } from "zod";
import { validateEmailRecipient, validateTelegramChatId } from "./recipients";

// Single definition of the notification channels. Adding a channel means
// extending this array, the schema below, and the per-channel send logic in
// server/alerts/delivery.ts.
export const ALERT_CHANNELS = ["email", "telegram"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];
export type AlertDeliveryTargets = Partial<Record<AlertChannel, string[]>>;

export const DeliverySettingsSchema = z
  .object({
    email: z
      .object({
        enabled: z.boolean(),
        to: z
          .array(
            z
              .string()
              .refine((value) => validateEmailRecipient(value) === null, {
                message: "Invalid email recipient",
              }),
          )
          .default([]),
      })
      .strict()
      .refine((value) => !value.enabled || value.to.length > 0, {
        message: "Email is enabled but has no recipients",
      })
      .optional(),
    telegram: z
      .object({
        enabled: z.boolean(),
        chatIds: z
          .array(
            z
              .string()
              .refine((value) => validateTelegramChatId(value) === null, {
                message: "Invalid Telegram chat ID",
              }),
          )
          .default([]),
      })
      .strict()
      .refine((value) => !value.enabled || value.chatIds.length > 0, {
        message: "Telegram is enabled but has no chat IDs",
      })
      .optional(),
  })
  .strict();

export type AlertDeliverySettings = z.infer<typeof DeliverySettingsSchema>;

export type NormalizedAlertDeliverySettings = {
  email: { enabled: boolean; to: string[] };
  telegram: { enabled: boolean; chatIds: string[] };
};

export function normalizeDeliverySettings(
  delivery: AlertDeliverySettings | null | undefined,
): NormalizedAlertDeliverySettings {
  return {
    email: {
      enabled: delivery?.email?.enabled ?? false,
      to: delivery?.email?.to ?? [],
    },
    telegram: {
      enabled: delivery?.telegram?.enabled ?? false,
      chatIds: delivery?.telegram?.chatIds ?? [],
    },
  };
}
