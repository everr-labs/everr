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
      url: z
        .string()
        .trim()
        .refine((v) => validateSlackWebhookUrl(v) === null, {
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
      .refine((v) => !emptyChannelError("telegram", v.enabled, v.entries.length), {
        message: EMPTY_CHANNEL_MESSAGES.telegram,
      })
      .optional(),
    slack: z
      .object({
        enabled: z.boolean(),
        webhooks: z.array(SlackWriteEntry).max(MAX_ENTRIES).default([]),
      })
      .strict()
      .refine((v) => !emptyChannelError("slack", v.enabled, v.webhooks.length), {
        message: EMPTY_CHANNEL_MESSAGES.slack,
      })
      .optional(),
  })
  .strict();

export type DeliverySettingsInput = z.infer<typeof DeliverySettingsSchema>;

// Ensures a stored row has the canonical shape — fills missing channels with
// defaults.  Rows still in the legacy { botToken, chatIds } shape will lose
// their telegram entries (the ~1-2 affected orgs reconfigure on next save).
export function ensureDeliveryDefaults(
  raw: StoredDeliverySettings | null | undefined,
): StoredDeliverySettings {
  const telegram =
    raw?.telegram && "entries" in raw.telegram ? raw.telegram : { enabled: false, entries: [] };
  return {
    telegram,
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

// Looks up the saved entry the form asked to keep. The form only sends ids it
// got from us, so an unknown id means something is wrong rather than a no-op.
function keepSaved<T extends { id: string }>(saved: readonly T[], id: string, label: string): T {
  const entry = saved.find((e) => e.id === id);
  if (!entry) throw new Error(`Unknown ${label} id: ${id}`);
  return entry;
}

// Resolves a write DTO against the current stored settings into the row to
// persist: an existing entry (sent as just `{ id }`) is kept verbatim so its
// write-only secret survives the round-trip, a new entry gets a fresh id, and
// stored ids the form dropped are gone.
export function resolveDeliverySettings(
  stored: StoredDeliverySettings,
  input: DeliverySettingsInput,
): StoredDeliverySettings {
  const result: StoredDeliverySettings = {};

  if (input.telegram) {
    const saved = stored.telegram?.entries ?? [];
    result.telegram = {
      enabled: input.telegram.enabled,
      entries: input.telegram.entries.map((entry) =>
        "id" in entry
          ? keepSaved(saved, entry.id, "Telegram entry")
          : {
              id: crypto.randomUUID(),
              ...(entry.name ? { name: entry.name } : {}),
              botToken: entry.botToken,
              chatId: entry.chatId,
            },
      ),
    };
  }

  if (input.slack) {
    const saved = stored.slack?.webhooks ?? [];
    result.slack = {
      enabled: input.slack.enabled,
      webhooks: input.slack.webhooks.map((entry) =>
        "id" in entry
          ? keepSaved(saved, entry.id, "Slack webhook")
          : {
              id: crypto.randomUUID(),
              ...(entry.name ? { name: entry.name } : {}),
              url: entry.url,
            },
      ),
    };
  }

  return result;
}
