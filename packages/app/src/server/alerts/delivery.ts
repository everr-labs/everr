import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { findSilenceForInstance, formatLabels } from "@/data/alerts/matchers";
import { db } from "@/db/client";
import { alertSettings, alertSilences } from "@/db/schema";
import { type AlertEventRow, insertAlertEvents } from "@/lib/clickhouse";
import { mailer } from "@/lib/mailer.server";
import { sendTelegramMessage } from "@/lib/telegram.server";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import { buildDeliveryEvent } from "./events";
import type { FiringInstance } from "./instances";

const MAX_LISTED_INSTANCES = 10;

export interface DeliveryInput {
  def: { id: string; organizationId: string; repoid: string; slug: string };
  kind: "firing" | "resolved";
  summary: string;
  description: string;
  // Current firing instance count after this evaluation.
  firingCount: number;
  // newlyFired for "firing", nowResolved for "resolved".
  instances: FiringInstance[];
}

function buildText(input: DeliveryInput, listed: FiringInstance[]): string {
  const lines = [input.summary];
  if (input.description) lines.push("", input.description);
  if (input.kind === "firing") {
    lines.push("", `Firing instances: ${input.firingCount}`);
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

export async function deliverAlertNotification(
  input: DeliveryInput,
): Promise<void> {
  const { def, kind } = input;

  const [settings] = await db
    .select()
    .from(alertSettings)
    .where(eq(alertSettings.organizationId, def.organizationId))
    .limit(1);
  const delivery = settings?.delivery;
  if (!delivery) return;
  if (kind === "resolved" && !delivery.notifyOnResolved) return;

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

  const targets: ("email" | "telegram")[] = [];
  if (delivery.email?.enabled && delivery.email.to.length > 0) {
    targets.push("email");
  }
  if (delivery.telegram?.enabled && delivery.telegram.chatIds.length > 0) {
    targets.push("telegram");
  }
  if (targets.length === 0) return;

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

  const events: AlertEventRow[] = [];
  if (input.instances.length > 0 && unsilenced.length === 0) {
    for (const target of targets) {
      events.push(
        buildDeliveryEvent({
          def,
          target,
          outcome: "silenced",
          silenceId: suppressingSilenceId,
        }),
      );
    }
    await recordDeliveryEvents(events);
    return;
  }

  const subject = `[${kind}] ${def.slug}`;
  const text = buildText(input, unsilenced);

  if (targets.includes("email")) {
    try {
      for (const to of delivery.email?.to ?? []) {
        mailer.send({ to, subject, text });
      }
      events.push(
        buildDeliveryEvent({ def, target: "email", outcome: "sent" }),
      );
    } catch (error) {
      serverLogger.error(
        "alerts.delivery.email_failed",
        exceptionAttributes(error),
      );
      events.push(
        buildDeliveryEvent({ def, target: "email", outcome: "failed" }),
      );
    }
  }

  if (targets.includes("telegram")) {
    try {
      for (const chatId of delivery.telegram?.chatIds ?? []) {
        await sendTelegramMessage(chatId, `${subject}\n${text}`);
      }
      events.push(
        buildDeliveryEvent({ def, target: "telegram", outcome: "sent" }),
      );
    } catch (error) {
      serverLogger.error(
        "alerts.delivery.telegram_failed",
        exceptionAttributes(error),
      );
      events.push(
        buildDeliveryEvent({ def, target: "telegram", outcome: "failed" }),
      );
    }
  }

  await recordDeliveryEvents(events);
}

async function recordDeliveryEvents(events: AlertEventRow[]) {
  await insertAlertEvents(events).catch((error) =>
    serverLogger.error(
      "alerts.delivery.event_insert_failed",
      exceptionAttributes(error),
    ),
  );
}
