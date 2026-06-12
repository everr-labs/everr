import { eq } from "drizzle-orm";
import type {
  AlertChannel,
  AlertDeliveryTargets,
} from "@/data/alerts/delivery-settings";
import { findSilenceForInstance, formatLabels } from "@/data/alerts/matchers";
import { activeSilenceConditions } from "@/data/alerts/silences";
import { db } from "@/db/client";
import { alertSettings, alertSilences } from "@/db/schema";
import { env } from "@/env";
import { mailer } from "@/lib/mailer.server";
import { sendTelegramMessage } from "@/lib/telegram.server";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import { buildAlertEmail } from "./email";
import { formatUtc, instanceDetail, MAX_LISTED_INSTANCES } from "./format";
import type { FiringInstance } from "./instances";

type DeliveryKind = "firing" | "resolved" | "partial_resolved";

// Firing deliveries carry the query result row each instance came from;
// resolved ones only have the labels (the row is gone by then).
export type DeliveryInstance = FiringInstance & {
  row?: Record<string, unknown>;
};

export interface DeliveryMetadata {
  deliveryTargets: AlertDeliveryTargets;
  silenceId: string;
}

export interface DeliveryInput {
  def: { id: string; organizationId: string; repoid: string; slug: string };
  kind: DeliveryKind;
  summary: string;
  description: string;
  // Current firing instance count after this evaluation.
  firingCount: number;
  // newlyFired for "firing", nowResolved for "resolved" and "partial_resolved".
  instances: DeliveryInstance[];
}

// Plain text by choice: no parse mode means nothing to escape, nothing for
// Telegram to reject, and the URL in the body needs no validation.
function buildTelegramText(
  input: DeliveryInput,
  listed: DeliveryInstance[],
  now: Date,
): string {
  const lines: string[] = [];
  switch (input.kind) {
    case "firing":
      lines.push(`🔥 ${input.def.slug} firing`);
      lines.push("", input.summary);
      if (input.description) lines.push(input.description);
      lines.push("", `Firing: ${input.firingCount}`);
      break;
    case "partial_resolved":
      lines.push(`✅ ${input.def.slug} partial resolved`);
      lines.push("", `Resolved: ${listed.length}`);
      lines.push(`Still firing: ${input.firingCount}`);
      break;
    case "resolved":
      lines.push(`✅ ${input.def.slug} resolved`);
      lines.push("", "All instances resolved");
      break;
  }
  for (const instance of listed.slice(0, MAX_LISTED_INSTANCES)) {
    const detail = instanceDetail(instance, input.kind, now);
    lines.push(
      `• ${formatLabels(instance.labels)}${detail ? ` — ${detail}` : ""}`,
    );
  }
  if (listed.length > MAX_LISTED_INSTANCES) {
    lines.push(`… and ${listed.length - MAX_LISTED_INSTANCES} more`);
  }
  lines.push("", formatUtc(now), alertUrl(input.def.id));
  return lines.join("\n");
}

function alertUrl(alertId: string): string {
  return new URL(`/alerts/${alertId}`, env.BETTER_AUTH_URL).toString();
}

function logDeliveryFailure(
  channel: AlertChannel,
  target: string,
  def: DeliveryInput["def"],
  error: unknown,
) {
  serverLogger.error(`alerts.delivery.${channel}_failed`, {
    ...exceptionAttributes(error),
    "alert.definition_id": def.id,
    "alert.slug": def.slug,
    "alert.delivery_target": target,
    "error.handled": true,
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

  const unsilenced: DeliveryInstance[] = [];
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
    return { deliveryTargets: {}, silenceId: suppressingSilenceId };
  }

  const { subject, text, html } = buildAlertEmail(input, unsilenced, {
    url: alertUrl(def.id),
    now,
  });
  const telegramText = buildTelegramText(input, unsilenced, now);

  // Each send is isolated: one bad recipient must not block the others, and
  // each failure is logged with the alert and target it belongs to.
  const sends: Promise<void>[] = [];
  for (const to of deliveryTargets.email ?? []) {
    sends.push(
      mailer
        .send({ to, subject, text, html })
        .catch((error) => logDeliveryFailure("email", to, def, error)),
    );
  }
  for (const chatId of deliveryTargets.telegram ?? []) {
    sends.push(
      sendTelegramMessage(chatId, telegramText).catch((error) =>
        logDeliveryFailure("telegram", chatId, def, error),
      ),
    );
  }
  await Promise.all(sends);

  return { deliveryTargets, silenceId: "" };
}
