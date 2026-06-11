import { eq } from "drizzle-orm";
import type { AlertDeliveryTargets } from "@/data/alerts/delivery-settings";
import { findSilenceForInstance, formatLabels } from "@/data/alerts/matchers";
import { activeSilenceConditions } from "@/data/alerts/silences";
import { db } from "@/db/client";
import { alertSettings, alertSilences } from "@/db/schema";
import { env } from "@/env";
import { mailer } from "@/lib/mailer.server";
import { sendTelegramMessage } from "@/lib/telegram.server";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import type { FiringInstance } from "./instances";

const MAX_LISTED_INSTANCES = 10;

type DeliveryKind = "firing" | "resolved" | "partial_resolved";

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
  instances: FiringInstance[];
}

function buildText(input: DeliveryInput, listed: FiringInstance[]): string {
  const lines: string[] = [];
  switch (input.kind) {
    case "firing":
      lines.push(input.summary);
      if (input.description) lines.push("", input.description);
      lines.push("", `Alert: ${alertUrl(input.def.id)}`);
      lines.push("", `Firing instances: ${input.firingCount}`);
      break;
    case "partial_resolved":
      lines.push(`Alert: ${alertUrl(input.def.id)}`);
      lines.push("", `Resolved instances: ${listed.length}`);
      lines.push(`Still firing instances: ${input.firingCount}`);
      break;
    case "resolved":
      lines.push(`Alert: ${alertUrl(input.def.id)}`);
      lines.push("", "All instances resolved");
      break;
  }
  for (const instance of listed.slice(0, MAX_LISTED_INSTANCES)) {
    lines.push(`- ${formatLabels(instance.labels)}`);
  }
  if (listed.length > MAX_LISTED_INSTANCES) {
    lines.push(`… and ${listed.length - MAX_LISTED_INSTANCES} more`);
  }
  return lines.join("\n");
}

function alertUrl(alertId: string): string {
  return new URL(`/alerts/${alertId}`, env.BETTER_AUTH_URL).toString();
}

export async function deliverAlertNotification(
  input: DeliveryInput,
): Promise<DeliveryMetadata | null> {
  const { def, kind } = input;

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

  const unsilenced: FiringInstance[] = [];
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

  const subject = `[${kind}] ${def.slug}`;
  const text = buildText(input, unsilenced);

  if (deliveryTargets.email) {
    try {
      for (const to of deliveryTargets.email) {
        mailer.send({ to, subject, text });
      }
    } catch (error) {
      serverLogger.error(
        "alerts.delivery.email_failed",
        exceptionAttributes(error),
      );
    }
  }

  if (deliveryTargets.telegram) {
    try {
      const telegramText = kind === "firing" ? `${subject}\n${text}` : text;
      for (const chatId of deliveryTargets.telegram) {
        await sendTelegramMessage(chatId, telegramText);
      }
    } catch (error) {
      serverLogger.error(
        "alerts.delivery.telegram_failed",
        exceptionAttributes(error),
      );
    }
  }

  return { deliveryTargets, silenceId: "" };
}
