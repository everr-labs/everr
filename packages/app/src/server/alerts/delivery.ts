import { eq } from "drizzle-orm";
import type {
  AlertChannel,
  AlertDeliveryTargets,
} from "@/data/alerts/delivery-settings";
import { findSilenceForInstance } from "@/data/alerts/matchers";
import { activeSilenceConditions } from "@/data/alerts/silences";
import { db } from "@/db/client";
import { alertSettings, alertSilences } from "@/db/schema";
import { env } from "@/env";
import { mailer } from "@/lib/mailer.server";
import { sendTelegramMessage } from "@/lib/telegram.server";
import {
  errorMessage,
  exceptionAttributes,
  serverLogger,
} from "@/telemetry/logger";
import { buildAlertEmail } from "./email";
import type { DeliveryInput, NotifiableInstance } from "./format";
import { buildTelegramText } from "./telegram";

export type { DeliveryInput } from "./format";

export interface DeliveryFailure {
  channel: AlertChannel;
  target: string;
  error: string;
}

export interface DeliveryMetadata {
  deliveryTargets: AlertDeliveryTargets;
  silenceId: string;
  // Per-target send failures, recorded as `delivery_failed` alert events by
  // the caller. Sends fail for plenty of reasons outside our control, so they
  // are tracked as events (and warn logs), not errors.
  failures: DeliveryFailure[];
}

function alertUrl(alertId: string): string {
  return new URL(`/alerts/${alertId}`, env.BETTER_AUTH_URL).toString();
}

function recordDeliveryFailure(
  failures: DeliveryFailure[],
  channel: AlertChannel,
  target: string,
  def: DeliveryInput["def"],
  error: unknown,
) {
  serverLogger.warn(`alerts.delivery.${channel}_failed`, {
    ...exceptionAttributes(error),
    "alert.definition_id": def.id,
    "alert.slug": def.slug,
    "alert.delivery_target": target,
    "error.handled": true,
  });
  failures.push({
    channel,
    target,
    error: errorMessage(error),
  });
}

export async function deliverAlertNotification(
  input: DeliveryInput,
): Promise<DeliveryMetadata | null> {
  const { def } = input;

  const now = new Date();
  const [[settings], silences] = await Promise.all([
    db
      .select()
      .from(alertSettings)
      .where(eq(alertSettings.organizationId, def.organizationId))
      .limit(1),
    db
      .select({
        id: alertSilences.id,
        matchers: alertSilences.matchers,
      })
      .from(alertSilences)
      .where(activeSilenceConditions(def.organizationId, def.id, now)),
  ]);
  const delivery = settings?.delivery;
  if (!delivery) return null;

  const deliveryTargets: AlertDeliveryTargets = {};
  if (delivery.email?.enabled && delivery.email.to.length > 0) {
    deliveryTargets.email = delivery.email.to;
  }
  if (delivery.telegram?.enabled && delivery.telegram.chatIds.length > 0) {
    deliveryTargets.telegram = delivery.telegram.chatIds;
  }
  if (Object.keys(deliveryTargets).length === 0) return null;

  const unsilenced: NotifiableInstance[] = [];
  let suppressingSilenceId = "";
  for (const instance of input.instances) {
    const silence = findSilenceForInstance(silences, instance.labels);
    if (silence) {
      suppressingSilenceId = suppressingSilenceId || silence.id;
    } else {
      unsilenced.push(instance);
    }
  }

  if (input.instances.length > 0 && unsilenced.length === 0) {
    return {
      deliveryTargets: {},
      silenceId: suppressingSilenceId,
      failures: [],
    };
  }

  const buildOptions = { url: alertUrl(def.id), now };
  const { subject, text, html } = buildAlertEmail(
    input,
    unsilenced,
    buildOptions,
  );
  const telegramText = buildTelegramText(input, unsilenced, buildOptions);

  // Each send is isolated: one bad recipient must not block the others, and
  // each failure is recorded with the alert and target it belongs to.
  const failures: DeliveryFailure[] = [];
  const sends: Promise<void>[] = [];
  for (const to of deliveryTargets.email ?? []) {
    sends.push(
      mailer
        .send({ to, subject, text, html })
        .catch((error) =>
          recordDeliveryFailure(failures, "email", to, def, error),
        ),
    );
  }
  for (const chatId of deliveryTargets.telegram ?? []) {
    sends.push(
      sendTelegramMessage(chatId, telegramText).catch((error) =>
        recordDeliveryFailure(failures, "telegram", chatId, def, error),
      ),
    );
  }
  await Promise.all(sends);

  return { deliveryTargets, silenceId: "", failures };
}
