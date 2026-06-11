import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { findSilenceForInstance, formatLabels } from "@/data/alerts/matchers";
import { db } from "@/db/client";
import { alertSettings, alertSilences } from "@/db/schema";
import { env } from "@/env";
import { mailer } from "@/lib/mailer.server";
import { sendTelegramMessage } from "@/lib/telegram.server";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import type { FiringInstance } from "./instances";

const MAX_LISTED_INSTANCES = 10;

type DeliveryKind = "firing" | "resolved" | "partial_resolved";
export type DeliveryTargetMap = Partial<Record<"email" | "telegram", string[]>>;

export interface DeliveryMetadata {
  deliveryTargets: DeliveryTargetMap;
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
  if (input.kind === "firing") {
    lines.push(input.summary);
    if (input.description) lines.push("", input.description);
    lines.push("", `Alert: ${alertUrl(input.def.id)}`);
  } else {
    lines.push(`Alert: ${alertUrl(input.def.id)}`);
  }
  if (input.kind === "firing") {
    lines.push("", `Firing instances: ${input.firingCount}`);
  } else if (input.kind === "partial_resolved") {
    lines.push("", `Resolved instances: ${listed.length}`);
    lines.push(`Still firing instances: ${input.firingCount}`);
  } else {
    lines.push("", "All instances resolved");
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

  const [settings] = await db
    .select()
    .from(alertSettings)
    .where(eq(alertSettings.organizationId, def.organizationId))
    .limit(1);
  const delivery = settings?.delivery;
  if (!delivery) return null;

  const now = new Date();
  const silences = await db
    .select({
      id: alertSilences.id,
      matchers: alertSilences.matchers,
    })
    .from(alertSilences)
    .where(
      and(
        eq(alertSilences.organizationId, def.organizationId),
        eq(alertSilences.alertDefinitionId, def.id),
        lte(alertSilences.startsAt, now),
        gt(alertSilences.endsAt, now),
        isNull(alertSilences.cancelledAt),
      ),
    );

  const deliveryTargets: DeliveryTargetMap = {};
  if (delivery.email?.enabled && delivery.email.to.length > 0) {
    deliveryTargets.email = delivery.email.to;
  }
  if (delivery.telegram?.enabled && delivery.telegram.chatIds.length > 0) {
    deliveryTargets.telegram = delivery.telegram.chatIds;
  }
  const targetTypes = Object.keys(deliveryTargets) as ("email" | "telegram")[];
  if (targetTypes.length === 0) return null;

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
