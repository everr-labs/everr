import { z } from "zod";
import { validateSlackWebhookUrl, validateTelegramChatId } from "./recipients";

// Single definition of the notification channels. Adding a channel means
// extending this array, the schema below, and the per-channel send logic in
// server/alerts/04-delivery.ts.
export const ALERT_CHANNELS = ["telegram", "slack"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];
export type AlertDeliveryTargets = Partial<Record<AlertChannel, string[]>>;

const MAX_ENTRIES = 20;
const MAX_NAME_LENGTH = 50;

// "enabled channels need at least one entry", stated once for the schema and the
// settings form's inline validation.
const EMPTY_CHANNEL_MESSAGES: Record<AlertChannel, string> = {
  telegram: "Telegram is enabled but has no entries",
  slack: "Slack is enabled but has no webhooks",
};

function emptyChannelError(
  channel: AlertChannel,
  enabled: boolean,
  count: number,
): string | undefined {
  return enabled && count === 0 ? EMPTY_CHANNEL_MESSAGES[channel] : undefined;
}

// ---- Stored shape (server/db only — holds secrets) ----
export type StoredTelegramEntry = {
  id: string;
  name?: string;
  botToken: string;
  chatId: string;
};
export type StoredSlackWebhook = { id: string; name?: string; url: string };
export type StoredDeliverySettings = {
  telegram?: { enabled: boolean; entries: StoredTelegramEntry[] };
  slack?: { enabled: boolean; webhooks: StoredSlackWebhook[] };
};

// ---- Read DTO (returned to the browser — secrets stripped) ----
export type NormalizedAlertDeliverySettings = {
  telegram: {
    enabled: boolean;
    entries: { id: string; name?: string; chatId: string }[];
  };
  slack: { enabled: boolean; webhooks: { id: string; name?: string }[] };
};

// ---- Write DTO (browser -> server): keep-by-id OR a brand-new entry ----
const nameField = z.string().trim().max(MAX_NAME_LENGTH).optional();

const TelegramWriteEntry = z.union([
  z.object({ id: z.string() }).strict(),
  z
    .object({
      name: nameField,
      botToken: z.string().trim().min(1, "Telegram bot token is required"),
      chatId: z.string().refine((v) => validateTelegramChatId(v) === null, {
        message: "Invalid Telegram chat ID",
      }),
    })
    .strict(),
]);

const SlackWriteEntry = z.union([
  z.object({ id: z.string() }).strict(),
  z
    .object({
      name: nameField,
      url: z.string().refine((v) => validateSlackWebhookUrl(v) === null, {
        message: "Invalid Slack webhook URL",
      }),
    })
    .strict(),
]);

export const DeliverySettingsSchema = z
  .object({
    telegram: z
      .object({
        enabled: z.boolean(),
        entries: z.array(TelegramWriteEntry).max(MAX_ENTRIES).default([]),
      })
      .strict()
      .refine(
        (v) => !emptyChannelError("telegram", v.enabled, v.entries.length),
        {
          message: EMPTY_CHANNEL_MESSAGES.telegram,
        },
      )
      .optional(),
    slack: z
      .object({
        enabled: z.boolean(),
        webhooks: z.array(SlackWriteEntry).max(MAX_ENTRIES).default([]),
      })
      .strict()
      .refine(
        (v) => !emptyChannelError("slack", v.enabled, v.webhooks.length),
        {
          message: EMPTY_CHANNEL_MESSAGES.slack,
        },
      )
      .optional(),
  })
  .strict();

export type DeliverySettingsInput = z.infer<typeof DeliverySettingsSchema>;

type LegacyTelegram = {
  enabled?: boolean;
  botToken?: string;
  chatIds?: string[];
};

// Reads a stored row (possibly the legacy { botToken, chatIds } telegram shape)
// into the canonical entry shape. Legacy ids are deterministic (`tg-<chatId>`)
// so a form loaded from one read resolves correctly when saved through another.
export function migrateStoredDeliverySettings(
  raw: StoredDeliverySettings | null | undefined,
): StoredDeliverySettings {
  const telegram = raw?.telegram as
    | StoredDeliverySettings["telegram"]
    | LegacyTelegram
    | undefined;

  let telegramOut: StoredDeliverySettings["telegram"];
  if (telegram && "entries" in telegram) {
    telegramOut = telegram;
  } else if (telegram && Array.isArray((telegram as LegacyTelegram).chatIds)) {
    const legacy = telegram as LegacyTelegram;
    telegramOut = {
      enabled: legacy.enabled ?? false,
      entries: (legacy.chatIds ?? []).map((chatId) => ({
        id: `tg-${chatId}`,
        name: undefined,
        botToken: legacy.botToken ?? "",
        chatId,
      })),
    };
  } else {
    telegramOut = { enabled: false, entries: [] };
  }

  return {
    telegram: telegramOut,
    slack: raw?.slack ?? { enabled: false, webhooks: [] },
  };
}

export function redactDeliverySecrets(
  stored: StoredDeliverySettings,
): NormalizedAlertDeliverySettings {
  return {
    telegram: {
      enabled: stored.telegram?.enabled ?? false,
      entries: (stored.telegram?.entries ?? []).map((e) => ({
        id: e.id,
        ...(e.name ? { name: e.name } : {}),
        chatId: e.chatId,
      })),
    },
    slack: {
      enabled: stored.slack?.enabled ?? false,
      webhooks: (stored.slack?.webhooks ?? []).map((w) => ({
        id: w.id,
        ...(w.name ? { name: w.name } : {}),
      })),
    },
  };
}

// Resolves a write DTO against the current stored settings: keep-by-id resolves
// to the stored entry verbatim, a new entry gets a fresh id, and stored ids
// absent from the input are dropped.
export function mergeDeliveryEntries(
  stored: StoredDeliverySettings,
  input: DeliverySettingsInput,
): StoredDeliverySettings {
  const result: StoredDeliverySettings = {};

  if (input.telegram) {
    const existing = stored.telegram?.entries ?? [];
    result.telegram = {
      enabled: input.telegram.enabled,
      entries: input.telegram.entries.map((entry): StoredTelegramEntry => {
        if ("id" in entry) {
          const found = existing.find((e) => e.id === entry.id);
          if (!found) throw new Error(`Unknown Telegram entry id: ${entry.id}`);
          return found;
        }
        return {
          id: crypto.randomUUID(),
          ...(entry.name ? { name: entry.name } : {}),
          botToken: entry.botToken,
          chatId: entry.chatId,
        };
      }),
    };
  }

  if (input.slack) {
    const existing = stored.slack?.webhooks ?? [];
    result.slack = {
      enabled: input.slack.enabled,
      webhooks: input.slack.webhooks.map((entry): StoredSlackWebhook => {
        if ("id" in entry) {
          const found = existing.find((w) => w.id === entry.id);
          if (!found) throw new Error(`Unknown Slack webhook id: ${entry.id}`);
          return found;
        }
        return {
          id: crypto.randomUUID(),
          ...(entry.name ? { name: entry.name } : {}),
          url: entry.url,
        };
      }),
    };
  }

  return result;
}
