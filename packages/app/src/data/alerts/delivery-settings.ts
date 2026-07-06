import { z } from "zod";
import type { CcReceiver, CcRoute } from "@/data/cc/types";
import {
  validateEmailRecipient,
  validateSlackWebhookUrl,
  validateTelegramBotToken,
  validateTelegramChatId,
} from "./recipients";

// The managed CC receivers backing org-level delivery. The UI writes these;
// power-user receivers (any other name) are untouched.
export const DEFAULT_EMAIL_RECEIVER = "everr-default-email";
export const DEFAULT_TELEGRAM_RECEIVER = "everr-default-telegram";
export const DEFAULT_SLACK_RECEIVER = "everr-default-slack";

// Single definition of the notification channels. Adding a channel means
// extending this array, the schema below, and the managed CC receiver mapping.
const ALERT_CHANNELS = ["email", "telegram"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

// The "enabled channels need at least one recipient" rule, stated once and
// consumed by both the server schema below and the settings form's inline
// field validation.
const EMPTY_CHANNEL_MESSAGES: Record<AlertChannel, string> = {
  email: "Email is enabled but has no recipients",
  telegram: "Telegram is enabled but has no chat IDs",
};

const MISSING_TELEGRAM_BOT_TOKEN_MESSAGE =
  "Telegram is enabled but has no bot token";

const MISSING_SLACK_WEBHOOK_URL_MESSAGE =
  "Slack is enabled but has no webhook URL";

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

// Slack has no recipient list — a single webhook URL secret. Mirrors the
// telegram bot-token check: the URL's own validator supplies the precise
// message (empty or malformed) surfaced inline in the form.
export function slackWebhookUrlError(
  enabled: boolean,
  webhookUrl: string,
): string | undefined {
  return enabled
    ? (validateSlackWebhookUrl(webhookUrl) ?? undefined)
    : undefined;
}

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
          .max(50)
          .default([]),
      })
      .strict()
      .refine((value) => !emptyChannelError("email", value.enabled, value.to), {
        message: EMPTY_CHANNEL_MESSAGES.email,
      })
      .optional(),
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
    slack: z
      .object({
        enabled: z.boolean(),
        webhookUrl: z.string().trim().default(""),
      })
      .strict()
      .refine(
        (value) => !slackWebhookUrlError(value.enabled, value.webhookUrl),
        { message: MISSING_SLACK_WEBHOOK_URL_MESSAGE },
      )
      .optional(),
    // How often a still-firing alert re-notifies, in seconds (applied as
    // repeat_interval_secs on the managed catch-all routes). null = off (CC
    // never re-notifies); when set, CC's floor is 60s.
    remindEverySeconds: z.number().int().min(60).nullable().default(null),
  })
  .strict();

export type AlertDeliverySettings = z.infer<typeof DeliverySettingsSchema>;

export type NormalizedAlertDeliverySettings = {
  email: { enabled: boolean; to: string[] };
  telegram: { enabled: boolean; botToken: string; chatIds: string[] };
  slack: { enabled: boolean; webhookUrl: string };
  remindEverySeconds: number | null;
};

// The managed catch-all routes (one per managed receiver) carry the
// re-notify cadence. A route is one of them when it has empty matchers and
// targets a managed receiver.
const MANAGED_RECEIVERS = new Set<string>([
  DEFAULT_EMAIL_RECEIVER,
  DEFAULT_TELEGRAM_RECEIVER,
  DEFAULT_SLACK_RECEIVER,
]);

export function isManagedCatchAllRoute(route: {
  matchers: unknown[];
  receiver: string;
}): boolean {
  return route.matchers.length === 0 && MANAGED_RECEIVERS.has(route.receiver);
}

/**
 * Derive the "Remind every" value from the managed catch-all routes'
 * repeat_interval_secs. The three routes should agree; when they disagree we
 * surface the max so the next save writes it to all and converges them. null
 * (re-notify off) when no managed route carries an interval.
 */
export function remindEverySecondsFromRoutes(routes: CcRoute[]): number | null {
  let max: number | null = null;
  for (const route of routes) {
    if (!isManagedCatchAllRoute(route)) continue;
    const value = route.repeat_interval_secs;
    if (value === null) continue;
    if (max === null || value > max) max = value;
  }
  return max;
}

/** CC receivers (+ routes) → the form's normalized shape. */
export function receiversToDeliverySettings(
  receivers: CcReceiver[],
  routes: CcRoute[] = [],
): NormalizedAlertDeliverySettings {
  const email = receivers.find((r) => r.name === DEFAULT_EMAIL_RECEIVER);
  const telegram = receivers.find((r) => r.name === DEFAULT_TELEGRAM_RECEIVER);
  const slack = receivers.find((r) => r.name === DEFAULT_SLACK_RECEIVER);
  const to = email?.channel.type === "email" ? email.channel.to : [];
  const tg =
    telegram?.channel.type === "telegram"
      ? {
          botToken: telegram.channel.bot_token,
          chatIds: telegram.channel.chat_ids,
        }
      : { botToken: "", chatIds: [] };
  const webhookUrl = slack?.channel.type === "slack" ? slack.channel.url : "";
  return {
    email: { enabled: to.length > 0, to },
    telegram: {
      enabled: tg.chatIds.length > 0 && tg.botToken.length > 0,
      botToken: tg.botToken,
      chatIds: tg.chatIds,
    },
    slack: { enabled: webhookUrl.length > 0, webhookUrl },
    remindEverySeconds: remindEverySecondsFromRoutes(routes),
  };
}

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
      botToken: delivery?.telegram?.botToken?.trim() ?? "",
      chatIds: delivery?.telegram?.chatIds ?? [],
    },
    slack: {
      enabled: delivery?.slack?.enabled ?? false,
      webhookUrl: delivery?.slack?.webhookUrl?.trim() ?? "",
    },
    remindEverySeconds: delivery?.remindEverySeconds ?? null,
  };
}
