import { and, eq, ne, type SQL, sql } from "drizzle-orm";
import { decryptChannelConfig } from "@/data/alerting/delivery/channel-secrets.server";
import { sendChannelNotification } from "@/data/alerting/delivery/channel-sender.server";
import { db } from "@/db/client";
import { alertChannels, alertDeliveries } from "@/db/schema";
import { errorMessage } from "@/telemetry/logger";
import { sanitizeAlertError } from "../history/content";
import { ALERT_DELIVERY_MAX_ATTEMPTS } from "./config";
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
  const failDelivery = async (
    channelType: string,
    rawError: string,
    attempts: number | SQL,
  ) => {
    // A provider's error text routinely echoes back the webhook URL, which
    // for Slack, Discord and Telegram IS the secret; sanitize before it
    // reaches Postgres, same as the identical string already does on the
    // ClickHouse path (deliveryHistoryRow).
    const error = sanitizeAlertError(rawError);
    await db
      .update(alertDeliveries)
      .set({
        status: "failed",
        attempts,
        lastError: error,
        updatedAt: new Date(),
      })
      // Guarded on status <> 'sent': a racing or duplicate run must never be
      // able to mark an already-delivered row failed, whatever this read of
      // `row` saw.
      .where(
        and(
          eq(alertDeliveries.dedupKey, dedupKey),
          ne(alertDeliveries.status, "sent"),
        ),
      );
    await recordDeliveryOutcome({
      organizationId: row.delivery.organizationId,
      dedupKey,
      channelType,
      channelName: row.delivery.channelName,
      occurredAt: new Date(),
      outcome: "failed",
      error,
    });
  };
  const [liveRule] = await liveRuleForDeliveryQuery(db, dedupKey);
  if (!liveRule) {
    // A pause or delete that committed after the flush wrote this delivery.
    // Fail the delivery permanently instead of throwing: a retry can never
    // make a rule active again, and the trail must say why nothing arrived.
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
    // The max, not row.delivery.attempts + 1: this is a terminal decision
    // independent of how many sends were already tried, and both the
    // retention sweep and the terminal-cleanup index key "failed and done"
    // on attempts >= ALERT_DELIVERY_MAX_ATTEMPTS. A lower count would leave
    // this row, and the journal events it links, undeletable forever.
    await failDelivery(
      withheldChannelType,
      "Withheld: every rule behind this notification was paused or deleted before the send ran",
      ALERT_DELIVERY_MAX_ATTEMPTS,
    );
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
  } catch (cause) {
    // failDelivery's own write can throw too (a transient DB error, say);
    // let that one through unchanged rather than the real send failure it
    // would otherwise replace. `cause` on the original still carries it.
    try {
      await failDelivery(
        channelType,
        errorMessage(cause).slice(0, 8_000),
        // Computed in the UPDATE, not from the Node-side `row` read: two
        // racing runs of the same delivery would otherwise both compute the
        // same stale count and one attempt would go uncounted.
        sql`${alertDeliveries.attempts} + 1`,
      );
    } catch (bookkeepingError) {
      throw new Error(
        "alert delivery send failed, and recording it failed too",
        {
          cause: { sendError: cause, bookkeepingError },
        },
      );
    }
    throw cause;
  }
  // The send succeeded. Nothing from here on may run inside a try whose catch
  // reaches failDelivery: that would mark a delivered notification failed and
  // have Graphile send it a second time.
  const markSent = () =>
    db
      .update(alertDeliveries)
      .set({
        status: "sent",
        attempts: sql`${alertDeliveries.attempts} + 1`,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(alertDeliveries.dedupKey, dedupKey),
          ne(alertDeliveries.status, "sent"),
        ),
      );
  try {
    await markSent();
  } catch {
    try {
      await markSent();
    } catch (statusWriteError) {
      // The send went out but neither attempt to record it landed. Do not
      // classify this row failed: it was not a failed send. Leave it
      // pending and throw a distinct error so this run is not confused with
      // a send failure; the job queue's retry (or the reconciliation sweep,
      // ticket 23) is what resolves a row stuck here.
      throw new Error(
        "alert delivery sent, but its status write failed twice",
        { cause: statusWriteError },
      );
    }
  }
  // Outside the write's own try on purpose. Recording history must never be
  // able to send this delivery down the failure path.
  await recordDeliveryOutcome({
    organizationId: row.delivery.organizationId,
    dedupKey,
    channelType,
    channelName: row.delivery.channelName,
    occurredAt: new Date(),
    outcome: "succeeded",
  });
}
