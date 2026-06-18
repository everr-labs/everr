// Notification delivery, split across the evaluation and a retryable job:
//
// At evaluation time, `enqueueAlertNotification` resolves the delivery
// targets from the latest saved settings, applies active silences, renders
// the channel messages, and enqueues ONE `alerts/deliver` job per
// (channel, target). Settings and silence decisions are pinned to event time
// — retries re-send the same rendered message, they never re-evaluate who
// should receive it.
//
// `runDeliverySend` is the job: it performs exactly one send and throws on
// failure so Graphile Worker retries it with exponential backoff. One job per
// target means a retry can never re-send to a target that already succeeded.
// Only the final failed attempt records a `delivery_failed` alert event;
// earlier attempts just log a warning with the attempt count.

import { z } from "zod";
import type {
  AlertDeliveryTargets,
  StoredDeliverySettings,
} from "@/data/alerts/delivery-settings";
import { findSilenceForInstance, type Matcher } from "@/data/alerts/matchers";
import { env } from "@/env";
import { sendSlackMessage } from "@/lib/slack.server";
import { sendTelegramMessage } from "@/lib/telegram.server";
import { addWorkerJob } from "@/server/worker/jobs";
import {
  errorMessage,
  exceptionAttributes,
  serverLogger,
} from "@/telemetry/logger";
import { buildDeliveryFailureEvent, recordAlertEvents } from "./03-events";
import type {
  DeliveryInput,
  DeliveryKind,
  NotifiableInstance,
} from "./04-format";
import { buildSlackMessage, type SlackMessage } from "./04-slack";
import { buildTelegramText } from "./04-telegram";

export type { DeliveryInput } from "./04-format";

export interface ResolvedDeliveryContext {
  settings: { delivery: StoredDeliverySettings } | null;
  silences: { id: string; matchers: Matcher[] }[];
}

export const ALERT_DELIVER_TASK = "alerts/deliver";

// Alerts are time-sensitive: with Graphile's exponential backoff, five
// attempts span roughly two minutes; beyond that the notification is stale.
const DELIVERY_MAX_ATTEMPTS = 5;

const SendDefSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  repoid: z.string(),
  slug: z.string(),
});

// The full payload of one `alerts/deliver` job: everything the send needs,
// rendered at evaluation time. `def`/`scheduledFor` exist so a final failure
// can be recorded as a `delivery_failed` event for the right evaluation.
const SendBaseSchema = z.object({
  target: z.string(),
  def: SendDefSchema,
  scheduledFor: z.coerce.date(),
});

const TelegramSendSchema = SendBaseSchema.extend({
  channel: z.literal("telegram"),
  botToken: z.string(),
  text: z.string(),
});

const SlackSendSchema = SendBaseSchema.extend({
  channel: z.literal("slack"),
  webhookUrl: z.string(),
  message: z.custom<SlackMessage>(),
});

const DeliverySendSchema = z.discriminatedUnion("channel", [
  TelegramSendSchema,
  SlackSendSchema,
]);

export type DeliverySend = z.infer<typeof DeliverySendSchema>;

// What each kind contributed to the evaluation events: the silence that
// suppressed it (every instance of the kind silenced), or "" when it notified.
export type NotificationKind = "firing" | "resolved";

export interface NotificationOutcome {
  // Where the (single, combined) notification went; {} when nothing was sent.
  deliveryTargets: AlertDeliveryTargets;
  // Present for each kind that had instances this evaluation.
  perKind: Partial<Record<NotificationKind, { silenceId: string }>>;
}

export interface NotificationInput {
  def: DeliveryInput["def"];
  instances: NotifiableInstance[];
}

function alertUrl(alertId: string): string {
  return new URL(`/alerts/${alertId}`, env.BETTER_AUTH_URL).toString();
}

function instanceKind(instance: NotifiableInstance): NotificationKind {
  return instance.kind === "resolved" ? "resolved" : "firing";
}

// The message header reflects what actually goes out after silencing, so a
// fully-silenced firing half correctly drops a mixed evaluation to "resolved".
function deriveMessageKind(instances: NotifiableInstance[]): DeliveryKind {
  const hasFiring = instances.some((i) => instanceKind(i) === "firing");
  const hasResolved = instances.some((i) => instanceKind(i) === "resolved");
  if (hasFiring && hasResolved) return "mixed";
  return hasResolved ? "resolved" : "firing";
}

// Resolves targets, applies silences, renders the message, and enqueues the
// per-target delivery jobs. Returns what the evaluation events should record:
// per kind, the attempted target map or the suppressing silence.
export async function enqueueAlertNotification(
  input: NotificationInput,
  scheduledFor: Date,
  context: ResolvedDeliveryContext,
): Promise<NotificationOutcome | null> {
  const { def } = input;

  const delivery = context.settings?.delivery;
  if (!delivery) return null;
  const silences = context.silences;

  const deliveryTargets: AlertDeliveryTargets = {};
  const telegramEntries = delivery.telegram?.enabled
    ? (delivery.telegram.entries ?? [])
    : [];
  const slackWebhooks = delivery.slack?.enabled
    ? (delivery.slack.webhooks ?? [])
    : [];
  if (telegramEntries.length > 0)
    deliveryTargets.telegram = telegramEntries.map((e) => e.chatId);
  if (slackWebhooks.length > 0)
    deliveryTargets.slack = slackWebhooks.map((w) => w.id);
  if (Object.keys(deliveryTargets).length === 0) return null;

  // Resolve each instance's silence once, then derive the per-kind outcome and
  // the instances that still notify.
  const resolved = input.instances.map((instance) => ({
    instance,
    silence: findSilenceForInstance(silences, instance.labels),
  }));
  const unsilenced = resolved.filter((r) => !r.silence).map((r) => r.instance);

  // Per kind: "" when at least one of its instances notifies, otherwise the
  // first matching silence's id (the kind was fully suppressed).
  const perKind: NotificationOutcome["perKind"] = {};
  for (const kind of ["firing", "resolved"] as const) {
    const ofKind = resolved.filter((r) => instanceKind(r.instance) === kind);
    if (ofKind.length === 0) continue;
    const suppressed = ofKind.every((r) => r.silence);
    perKind[kind] = {
      silenceId: suppressed
        ? (ofKind.find((r) => r.silence)?.silence?.id ?? "")
        : "",
    };
  }

  // Nothing left to send, but still report the per-kind silence outcome.
  if (unsilenced.length === 0) {
    return { deliveryTargets: {}, perKind };
  }

  const messageKind = deriveMessageKind(unsilenced);
  const now = new Date();
  const buildOptions = { url: alertUrl(def.id), now };
  const deliveryInput = { def, kind: messageKind, instances: unsilenced };

  const telegramText = buildTelegramText(deliveryInput, buildOptions);
  const slackMessage = buildSlackMessage(deliveryInput, buildOptions);

  // Zod strips unknown keys, so this is the schema-defined subset of the full
  // definition row — one field list to maintain.
  const sendDef = SendDefSchema.parse(def);

  const sends: DeliverySend[] = [
    ...telegramEntries.map(
      (entry): DeliverySend => ({
        channel: "telegram",
        target: entry.chatId,
        botToken: entry.botToken,
        text: telegramText,
        def: sendDef,
        scheduledFor,
      }),
    ),
    ...slackWebhooks.map(
      (webhook): DeliverySend => ({
        channel: "slack",
        target: webhook.id,
        webhookUrl: webhook.url,
        message: slackMessage,
        def: sendDef,
        scheduledFor,
      }),
    ),
  ];

  // The job key spans evaluation + message kind + target, so a retried
  // evaluation re-enqueues (replaces) the same jobs instead of duplicating
  // them. Sequential on purpose: each add_job is a sub-millisecond insert, and
  // a parallel fan-out would briefly monopolize the shared pg pool.
  for (const send of sends) {
    await addWorkerJob(ALERT_DELIVER_TASK, send, {
      jobKey: `${ALERT_DELIVER_TASK}:${def.id}:${scheduledFor.toISOString()}:${messageKind}:${send.channel}:${send.target}`,
      jobKeyMode: "replace",
      maxAttempts: DELIVERY_MAX_ATTEMPTS,
    });
  }

  return { deliveryTargets, perKind };
}

// The `alerts/deliver` task: one send, throwing on failure so Graphile Worker
// retries. Send failures are expected operational noise (providers flake,
// chats get deleted) — they log as warnings, and only the final attempt
// records a `delivery_failed` event.
export async function runDeliverySend(
  rawPayload: unknown,
  job: { attempts: number; max_attempts: number },
): Promise<void> {
  const send = DeliverySendSchema.parse(rawPayload);

  try {
    if (send.channel === "telegram") {
      await sendTelegramMessage(send.botToken, send.target, send.text);
    } else {
      await sendSlackMessage(send.webhookUrl, send.message);
    }
  } catch (error) {
    const finalAttempt = job.attempts >= job.max_attempts;
    serverLogger.warn(`alerts.delivery.${send.channel}_failed`, {
      ...exceptionAttributes(error),
      "alert.definition_id": send.def.id,
      "alert.slug": send.def.slug,
      "alert.delivery_target": send.target,
      "graphile_worker.job.attempts": job.attempts,
      "error.handled": finalAttempt,
    });
    if (finalAttempt) {
      await recordAlertEvents(
        send.def,
        [
          buildDeliveryFailureEvent({
            def: send.def,
            scheduledFor: send.scheduledFor,
            failure: {
              channel: send.channel,
              target: send.target,
              error: errorMessage(error),
            },
          }),
        ],
        "alerts.delivery.failure_event_insert_failed",
      );
    }
    throw error;
  }
}
