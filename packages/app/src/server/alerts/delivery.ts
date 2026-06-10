import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { alertSettings, alertSilences } from "@/db/schema";
import { type AlertEventRow, insertAlertEvents } from "@/lib/clickhouse";
import { mailer } from "@/lib/mailer.server";
import { sendTelegramMessage } from "@/lib/telegram.server";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";
import { buildDeliveryEvent } from "./events";

export interface DeliveryInput {
  def: { id: string; organizationId: string; repoid: string; slug: string };
  kind: "firing" | "resolved";
  summary: string;
  description: string;
}

export async function deliverAlertNotification(
  input: DeliveryInput,
): Promise<void> {
  const { def, kind, summary, description } = input;

  const [settings] = await db
    .select()
    .from(alertSettings)
    .where(eq(alertSettings.organizationId, def.organizationId))
    .limit(1);
  const delivery = settings?.delivery;
  if (!delivery) return;
  if (kind === "resolved" && !delivery.notifyOnResolved) return;

  const now = new Date();
  const [silence] = await db
    .select()
    .from(alertSilences)
    .where(
      and(
        eq(alertSilences.organizationId, def.organizationId),
        eq(alertSilences.alertDefinitionId, def.id),
        lte(alertSilences.startsAt, now),
        gt(alertSilences.endsAt, now),
        isNull(alertSilences.cancelledAt),
      ),
    )
    .limit(1);

  const targets: ("email" | "telegram")[] = [];
  if (delivery.email?.enabled && delivery.email.to.length > 0) {
    targets.push("email");
  }
  if (delivery.telegram?.enabled && delivery.telegram.chatIds.length > 0) {
    targets.push("telegram");
  }
  if (targets.length === 0) return;

  const events: AlertEventRow[] = [];
  if (silence) {
    for (const target of targets) {
      events.push(
        buildDeliveryEvent({
          def,
          target,
          outcome: "silenced",
          silenceId: silence.id,
        }),
      );
    }
    await recordDeliveryEvents(events);
    return;
  }

  const subject = `[${kind}] ${def.slug}`;
  const text = description ? `${summary}\n\n${description}` : summary;

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
