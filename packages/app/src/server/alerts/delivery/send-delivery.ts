import { and, eq } from "drizzle-orm";
import { decryptChannelConfig } from "@/data/alerting/delivery/channel-secrets.server";
import { sendChannelNotification } from "@/data/alerting/delivery/channel-sender.server";
import { db } from "@/db/client";
import { alertChannels, alertDeliveries } from "@/db/schema";
import { errorMessage } from "@/telemetry/logger";
import { recordDeliveryOutcome } from "./history";
import { liveRuleForDeliveryQuery } from "./journal-reader";
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
  const [liveRule] = await liveRuleForDeliveryQuery(db, dedupKey);
  if (!liveRule) {
    // A pause or delete that committed after the flush wrote this delivery.
    // Fail the delivery permanently instead of throwing: a retry can never
    // make a rule active again, and the trail must say why nothing arrived.
    const error =
      "Withheld: every rule behind this notification was paused or deleted before the send ran";
    await db
      .update(alertDeliveries)
      .set({
        status: "failed",
        attempts: row.delivery.attempts + 1,
        lastError: error,
        updatedAt: new Date(),
      })
      .where(eq(alertDeliveries.dedupKey, dedupKey));
    // Decrypted only to label the trail: without it the row files its
    // delivery_targets under the literal type "unknown", and a reader cannot
    // tell "type unresolvable" from "a channel of type unknown". The
    // placeholder keeps its one honest use: a config that cannot be read.
    let withheldChannelType = "unknown";
    try {
      withheldChannelType = decryptChannelConfig(
        row.delivery.organizationId,
        row.channel.id,
        row.channel.encryptedConfig,
      ).type;
    } catch {
      // Config unreadable; the placeholder stays.
    }
    await recordDeliveryOutcome({
      organizationId: row.delivery.organizationId,
      dedupKey,
      channelType: withheldChannelType,
      channelName: row.delivery.channelName,
      occurredAt: new Date(),
      outcome: "failed",
      error,
    });
    return;
  }
  // Unresolvable until the config decrypts, and the failure path still needs a
  // channel type for the trail.
  let channelType = "unknown";
  try {
    const config = decryptChannelConfig(
      row.delivery.organizationId,
      row.channel.id,
      row.channel.encryptedConfig,
    );
    channelType = config.type;
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
    const error = errorMessage(cause).slice(0, 8_000);
    await db
      .update(alertDeliveries)
      .set({
        status: "failed",
        attempts: row.delivery.attempts + 1,
        lastError: error,
        updatedAt: new Date(),
      })
      .where(eq(alertDeliveries.dedupKey, dedupKey));
    await recordDeliveryOutcome({
      organizationId: row.delivery.organizationId,
      dedupKey,
      channelType,
      channelName: row.delivery.channelName,
      occurredAt: new Date(),
      outcome: "failed",
      error,
    });
    throw cause;
  }
  // Outside the try on purpose. Recording history must never be able to send
  // this delivery down the failure path, which would mark a delivered
  // notification as failed and have Graphile send it a second time.
  await recordDeliveryOutcome({
    organizationId: row.delivery.organizationId,
    dedupKey,
    channelType,
    channelName: row.delivery.channelName,
    occurredAt: new Date(),
    outcome: "succeeded",
  });
}
