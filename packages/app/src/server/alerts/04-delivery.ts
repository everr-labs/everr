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
  AlertDeliverySettings,
  AlertDeliveryTargets,
} from "@/data/alerts/delivery-settings";
import { findSilenceForInstance, type Matcher } from "@/data/alerts/matchers";
import { env } from "@/env";
import { mailer } from "@/lib/mailer.server";
import { sendTelegramMessage } from "@/lib/telegram.server";
import { addWorkerJob } from "@/server/worker/jobs";
import {
  errorMessage,
  exceptionAttributes,
  serverLogger,
} from "@/telemetry/logger";
import { buildDeliveryFailureEvent, recordAlertEvents } from "./03-events";
import { buildAlertEmail } from "./04-email";
import type { DeliveryInput } from "./04-format";
import { buildTelegramText } from "./04-telegram";

export type { DeliveryInput } from "./04-format";

export interface ResolvedDeliveryContext {
  settings: { delivery: AlertDeliverySettings } | null;
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
  text: z.string(),
  def: SendDefSchema,
  scheduledFor: z.coerce.date(),
});

const DeliverySendSchema = z.discriminatedUnion("channel", [
  SendBaseSchema.extend({
    channel: z.literal("email"),
    subject: z.string(),
    html: z.string(),
  }),
  SendBaseSchema.extend({
    channel: z.literal("telegram"),
    botToken: z.string(),
  }),
]);

export type DeliverySend = z.infer<typeof DeliverySendSchema>;

export interface DeliveryMetadata {
  deliveryTargets: AlertDeliveryTargets;
  silenceId: string;
}

function alertUrl(alertId: string): string {
  return new URL(`/alerts/${alertId}`, env.BETTER_AUTH_URL).toString();
}

// Resolves targets, applies silences, renders messages, and enqueues the
// per-target delivery jobs. Returns what the evaluation event should record:
// the attempted target map, or the suppressing silence.
export async function enqueueAlertNotification(
  input: DeliveryInput,
  scheduledFor: Date,
  context: ResolvedDeliveryContext,
): Promise<DeliveryMetadata | null> {
  const { def, kind } = input;

  const delivery = context.settings?.delivery;
  if (!delivery) return null;
  const silences = context.silences;

  const deliveryTargets: AlertDeliveryTargets = {};
  if (delivery.email?.enabled && delivery.email.to.length > 0) {
    deliveryTargets.email = delivery.email.to;
  }
  if (delivery.telegram?.enabled && delivery.telegram.chatIds.length > 0) {
    deliveryTargets.telegram = delivery.telegram.chatIds;
  }
  if (Object.keys(deliveryTargets).length === 0) return null;

  const silence = findSilenceForInstance(silences, input.instance.labels);
  if (silence) {
    return { deliveryTargets: {}, silenceId: silence.id };
  }

  const now = new Date();
  const buildOptions = { url: alertUrl(def.id), now };
  const { subject, text, html } = buildAlertEmail(input, buildOptions);
  const telegramText = buildTelegramText(input, buildOptions);

  // Zod strips unknown keys, so this is the schema-defined subset of the full
  // definition row — one field list to maintain.
  const sendDef = SendDefSchema.parse(def);
  const sends: DeliverySend[] = [
    ...(deliveryTargets.email ?? []).map(
      (target): DeliverySend => ({
        channel: "email",
        target,
        subject,
        text,
        html,
        def: sendDef,
        scheduledFor,
      }),
    ),
    ...(deliveryTargets.telegram ?? []).map(
      (target): DeliverySend => ({
        channel: "telegram",
        target,
        botToken: delivery.telegram?.botToken ?? "",
        text: telegramText,
        def: sendDef,
        scheduledFor,
      }),
    ),
  ];

  // The job key spans evaluation + notification kind + target, so a retried
  // evaluation re-enqueues (replaces) the same jobs instead of duplicating
  // them, while firing and resolved sends of one evaluation stay distinct.
  // Sequential on purpose: each add_job is a sub-millisecond insert, and a
  // parallel fan-out would briefly monopolize the shared pg pool.
  for (const send of sends) {
    await addWorkerJob(ALERT_DELIVER_TASK, send, {
      jobKey: `${ALERT_DELIVER_TASK}:${def.id}:${scheduledFor.toISOString()}:${kind}:${send.channel}:${send.target}`,
      jobKeyMode: "replace",
      maxAttempts: DELIVERY_MAX_ATTEMPTS,
    });
  }

  return { deliveryTargets, silenceId: "" };
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
    if (send.channel === "email") {
      await mailer.send({
        to: send.target,
        subject: send.subject,
        text: send.text,
        html: send.html,
      });
    } else {
      await sendTelegramMessage(send.botToken, send.target, send.text);
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
