import { and, eq } from "drizzle-orm";
import { decryptChannelConfig } from "@/data/alerting/delivery/channel-secrets.server";
import { sendChannelNotification } from "@/data/alerting/delivery/channel-sender.server";
import { db } from "@/db/client";
import { alertChannels, alertDeliveries } from "@/db/schema";
import { errorMessage } from "@/telemetry/logger";
import { AlertDeliveryTaskPayloadSchema } from "./tasks";

export async function sendAlertDelivery(rawPayload: unknown): Promise<void> {
  const { dedupKey } = AlertDeliveryTaskPayloadSchema.parse(rawPayload);
  const [row] = await db
    .select({ delivery: alertDeliveries, channel: alertChannels })
    .from(alertDeliveries)
    .innerJoin(
      alertChannels,
      and(
        eq(alertDeliveries.organizationId, alertChannels.organizationId),
        eq(alertDeliveries.channelId, alertChannels.id),
      ),
    )
    .where(eq(alertDeliveries.dedupKey, dedupKey))
    .limit(1);
  if (!row || row.delivery.status === "sent") return;
  try {
    const config = decryptChannelConfig(
      row.delivery.organizationId,
      row.channel.id,
      row.channel.encryptedConfig,
    );
    await sendChannelNotification(config, row.delivery.notification);
    await db
      .update(alertDeliveries)
      .set({
        status: "sent",
        attempts: row.delivery.attempts + 1,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(alertDeliveries.dedupKey, dedupKey));
  } catch (cause) {
    await db
      .update(alertDeliveries)
      .set({
        status: "failed",
        attempts: row.delivery.attempts + 1,
        lastError: errorMessage(cause).slice(0, 8_000),
        updatedAt: new Date(),
      })
      .where(eq(alertDeliveries.dedupKey, dedupKey));
    throw cause;
  }
}
