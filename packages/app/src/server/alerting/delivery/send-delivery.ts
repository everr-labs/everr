import { and, eq, ne, type SQL, sql } from "drizzle-orm";
import { decryptChannelConfig } from "@/data/alerting/delivery/channel-secrets.server";
import {
  ChannelSendError,
  sendChannelNotification,
} from "@/data/alerting/delivery/channel-sender.server";
import { ALERT_DELIVERY_MAX_ATTEMPTS } from "@/data/alerting/delivery/config";
import { AlertDeliveryTaskPayloadSchema } from "@/data/alerting/delivery/tasks";
import { db } from "@/db/client";
import { alertChannels, alertDeliveries } from "@/db/schema";
import { errorMessage } from "@/telemetry/logger";
import { sanitizeAlertError } from "../history/content";
import { recordAlertNotification, setAlertSpanAttributes } from "../telemetry";
import { recordDeliveryOutcome } from "./history";
import { liveRuleForDeliveryQuery } from "./journal-reader";

// The provider holds the endpoint's own answer apart from its error message
// so a channel test cannot reflect it back. The trail is where that answer is
// worth keeping: "channel_not_found" is what tells an operator what to fix.
// failDelivery sanitizes the joined text before it lands.
function sendFailureDetail(cause: unknown): string {
  const message = errorMessage(cause);
  const body = cause instanceof ChannelSendError ? cause.responseBody : "";
  return body ? `${message} ${body}` : message;
}

export async function sendAlertDelivery(rawPayload: unknown): Promise<void> {
  const { dedupKey } = AlertDeliveryTaskPayloadSchema.parse(rawPayload);
  const [row] = await db
    .select({ delivery: alertDeliveries, channel: alertChannels })
    .from(alertDeliveries)
    // Left, not inner: a channel deleted after the flush wrote this row
    // clears `channel_id`, and an inner join would drop the delivery here.
    // The row must still reach a terminal state with a reason.
    .leftJoin(
      alertChannels,
      and(
        eq(alertDeliveries.organizationId, alertChannels.organizationId),
        eq(alertDeliveries.channelId, alertChannels.id),
      ),
    )
    .where(eq(alertDeliveries.dedupKey, dedupKey))
    .limit(1);
  if (!row || row.delivery.status === "sent") return;
  setAlertSpanAttributes({ tenant: row.delivery.organizationId });
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
    const failedAt = new Date();
    await db
      .update(alertDeliveries)
      .set({
        status: "failed",
        attempts,
        lastError: error,
        updatedAt: failedAt,
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
      outcomeAt: failedAt,
      outcome: "failed",
      error,
    });
  };
  const channel = row.channel;
  if (!channel) {
    // No config left to send with, and no retry can bring it back. This is
    // terminal at the max attempts, for the same reason the withheld path
    // below is. Staying silent would read as "nothing was sent" with no
    // record of why, which the trail must never do.
    await failDelivery(
      "unknown",
      `Withheld: channel ${row.delivery.channelName} was deleted before the send ran`,
      ALERT_DELIVERY_MAX_ATTEMPTS,
    );
    recordAlertNotification({
      channelType: "unknown",
      outcome: "withheld",
    });
    return;
  }
  const [liveRule] = await liveRuleForDeliveryQuery(db, dedupKey);
  if (liveRule) {
    // Stamped before the send, from the row the correctness check already
    // read: measuring must never be a reason to touch the database again.
    setAlertSpanAttributes({
      slug: liveRule.slug,
      fireToPageMs: Date.now() - liveRule.firedAt.getTime(),
    });
  }
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
        channel.id,
        channel.encryptedConfig,
      ).type;
    } catch {
      // Config unreadable; the placeholder stays.
    }
    // The max, not attempts + 1. This is a terminal decision, whatever the
    // number of sends already tried. The retention sweep and the
    // terminal-cleanup index both key "failed and done" on attempts reaching
    // the max, so a lower count leaves this row, and the journal events it
    // links, undeletable forever.
    await failDelivery(
      withheldChannelType,
      "Withheld: every rule behind this notification was paused or deleted before the send ran",
      ALERT_DELIVERY_MAX_ATTEMPTS,
    );
    recordAlertNotification({
      channelType: withheldChannelType,
      outcome: "withheld",
    });
    return;
  }
  // Unresolvable until the config decrypts, and the failure path still needs a
  // channel type for the trail.
  let channelType = "unknown";
  try {
    const config = decryptChannelConfig(
      row.delivery.organizationId,
      channel.id,
      channel.encryptedConfig,
    );
    channelType = config.type;
    setAlertSpanAttributes({ channelType });
    await sendChannelNotification(config, row.delivery.notification);
  } catch (cause) {
    // A permanent failure (a 4xx other than 408/429: a revoked webhook, a
    // malformed payload) cannot succeed on retry, so it is recorded
    // terminally at the max attempts and not rethrown. Anything else is
    // transient and must reach Graphile's retry.
    const permanent = cause instanceof ChannelSendError && cause.permanent;
    // failDelivery's own write can throw too (a transient DB error, say);
    // let that one through unchanged rather than the real send failure it
    // would otherwise replace. `cause` on the original still carries it.
    try {
      await failDelivery(
        channelType,
        sendFailureDetail(cause).slice(0, 8_000),
        // Computed in the UPDATE, not from the Node-side `row` read: two
        // racing runs of the same delivery would otherwise both compute the
        // same stale count and one attempt would go uncounted. A permanent
        // failure instead jumps straight to the max, the same terminal
        // count retention and the cleanup index already require.
        permanent
          ? ALERT_DELIVERY_MAX_ATTEMPTS
          : sql`${alertDeliveries.attempts} + 1`,
      );
    } catch (bookkeepingError) {
      throw new Error(
        "alert delivery send failed, and recording it failed too",
        {
          cause: { sendError: cause, bookkeepingError },
        },
      );
    }
    recordAlertNotification({
      channelType,
      outcome: permanent ? "failed_permanent" : "failed_transient",
    });
    if (permanent) return;
    throw cause;
  }
  // The send succeeded. Nothing from here on may run inside a try whose catch
  // reaches failDelivery: that would mark a delivered notification failed and
  // have Graphile send it a second time.
  const sentAt = new Date();
  const markSent = () =>
    db
      .update(alertDeliveries)
      .set({
        status: "sent",
        attempts: sql`${alertDeliveries.attempts} + 1`,
        lastError: null,
        updatedAt: sentAt,
      })
      .where(
        and(
          eq(alertDeliveries.dedupKey, dedupKey),
          ne(alertDeliveries.status, "sent"),
        ),
      )
      .returning({ sentAt: alertDeliveries.updatedAt });
  let marked: { sentAt: Date }[];
  try {
    marked = await markSent();
  } catch {
    try {
      marked = await markSent();
    } catch (statusWriteError) {
      // The send went out but neither attempt to record it landed. Do not
      // classify this row failed: it was not a failed send. Leave it
      // pending and throw a distinct error so this run is not confused with
      // a send failure. The job queue's retry is what resolves a row stuck
      // here; nothing else does, since no reconciliation sweep exists.
      throw new Error(
        "alert delivery sent, but its status write failed twice",
        { cause: statusWriteError },
      );
    }
  }
  let outcomeAt = marked[0]?.sentAt;
  if (!outcomeAt) {
    // Another sender won the guarded transition. Reuse its committed stamp so
    // both writers rebuild byte-identical ClickHouse success rows.
    const [settled] = await db
      .select({
        status: alertDeliveries.status,
        sentAt: alertDeliveries.updatedAt,
      })
      .from(alertDeliveries)
      .where(eq(alertDeliveries.dedupKey, dedupKey))
      .limit(1);
    if (settled?.status !== "sent") {
      throw new Error("alert delivery sent, but its status was not recorded");
    }
    outcomeAt = settled.sentAt;
  }
  // Outside the write's own try on purpose. Recording history must never be
  // able to send this delivery down the failure path.
  await recordDeliveryOutcome({
    organizationId: row.delivery.organizationId,
    dedupKey,
    channelType,
    channelName: row.delivery.channelName,
    outcomeAt,
    outcome: "succeeded",
  });
  // Also outside any try that could reach failDelivery: a metric must never
  // be able to resend a delivered notification.
  recordAlertNotification({
    channelType,
    outcome: "delivered",
    latencySeconds: (Date.now() - liveRule.firedAt.getTime()) / 1000,
  });
}
