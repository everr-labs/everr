import { and, asc, eq } from "drizzle-orm";
import { alertingPartitionQueue } from "@/data/alerting/scheduling/evaluation-jobs.server";
import { db } from "@/db/client";
import {
  alertChannels,
  alertDefinitionChannels,
  alertDeliveries,
  alertDeliveryEvents,
  alertEvents,
  alertNotificationGroupEvents,
  alertNotificationGroups,
  alertReceiverChannels,
} from "@/db/schema";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";
import { ALERT_DELIVERY_MAX_ATTEMPTS } from "./config";
import {
  deferSuppressedEvent,
  isInhibited,
  matchingSilence,
} from "./suppression";
import { alertDeliveryHash } from "./targeting";
import {
  ALERT_FLUSH_GROUP_TASK,
  ALERT_SEND_DELIVERY_TASK,
  AlertGroupTaskPayloadSchema,
  IDLE_GROUP_FLUSH_AT,
} from "./tasks";

function formatNotification(events: (typeof alertEvents.$inferSelect)[]) {
  const firing = events.filter(
    (event) => event.eventType !== "instance_resolved",
  ).length;
  const resolved = events.length - firing;
  const title = [
    firing > 0 ? `${firing} firing` : "",
    resolved > 0 ? `${resolved} resolved` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const body = events
    .map((event) => {
      const labels = Object.entries(event.instanceLabels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join(", ");
      const heading = event.notificationTitle || event.slug;
      const detail = event.notificationDescription
        ? `: ${event.notificationDescription}`
        : "";
      return `${event.eventType === "instance_resolved" ? "Resolved" : "Firing"}: ${heading}${labels ? ` (${labels})` : ""}${detail}`;
    })
    .join("\n");
  return { title: `Everr alert: ${title}`, body };
}

export async function flushAlertGroup(rawPayload: unknown): Promise<void> {
  const { groupId } = AlertGroupTaskPayloadSchema.parse(rawPayload);
  const [group] = await db
    .select()
    .from(alertNotificationGroups)
    .where(eq(alertNotificationGroups.id, groupId))
    .limit(1);
  if (!group || group.nextFlushAt > new Date()) return;
  const candidates = (
    await db
      .select({ event: alertEvents })
      .from(alertNotificationGroupEvents)
      .innerJoin(
        alertEvents,
        and(
          eq(
            alertNotificationGroupEvents.organizationId,
            alertEvents.organizationId,
          ),
          eq(alertNotificationGroupEvents.eventId, alertEvents.id),
        ),
      )
      .where(eq(alertNotificationGroupEvents.groupId, group.id))
  ).map(({ event }) => event);
  if (candidates.length === 0) return;
  const events: typeof candidates = [];
  for (const event of candidates) {
    if (event.suppressed) continue;
    const now = new Date();
    const silence = await matchingSilence(event, now);
    const inhibited = silence ? false : await isInhibited(event);
    if (silence || inhibited) {
      await deferSuppressedEvent(event, silence, inhibited, now);
      continue;
    }
    if (event.silenced || event.inhibited || event.silenceId) {
      await db
        .update(alertEvents)
        .set({ silenced: false, inhibited: false, silenceId: null })
        .where(eq(alertEvents.id, event.id));
    }
    events.push(event);
  }
  const latestByInstance = new Map<string, (typeof events)[number]>();
  for (const event of events.sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  )) {
    latestByInstance.set(
      `${event.sourceKind}:${event.sourceDefinitionId}:${event.instanceFingerprint}`,
      event,
    );
  }
  const latest = [...latestByInstance.values()];
  const active = latest.filter(
    (event) => event.eventType !== "instance_resolved",
  );
  const hasNewEvents = latest.some(
    (event) => !group.lastFlushedAt || event.occurredAt > group.lastFlushedAt,
  );
  const notificationEvents = hasNewEvents ? latest : active;
  const channels = group.directAlertDefinitionId
    ? await db
        .select({ channel: alertChannels })
        .from(alertDefinitionChannels)
        .innerJoin(
          alertChannels,
          and(
            eq(
              alertDefinitionChannels.organizationId,
              alertChannels.organizationId,
            ),
            eq(alertDefinitionChannels.channelId, alertChannels.id),
          ),
        )
        .where(
          and(
            eq(alertDefinitionChannels.organizationId, group.organizationId),
            eq(
              alertDefinitionChannels.alertDefinitionId,
              group.directAlertDefinitionId,
            ),
          ),
        )
        .orderBy(asc(alertDefinitionChannels.position))
    : group.receiverId
      ? await db
          .select({ channel: alertChannels })
          .from(alertReceiverChannels)
          .innerJoin(
            alertChannels,
            and(
              eq(
                alertReceiverChannels.organizationId,
                alertChannels.organizationId,
              ),
              eq(alertReceiverChannels.channelId, alertChannels.id),
            ),
          )
          .where(
            and(
              eq(alertReceiverChannels.organizationId, group.organizationId),
              eq(alertReceiverChannels.receiverId, group.receiverId),
            ),
          )
          .orderBy(asc(alertReceiverChannels.position))
      : [];
  const notification = formatNotification(notificationEvents);
  await db.transaction(async (tx) => {
    for (const { channel } of notificationEvents.length > 0 ? channels : []) {
      const dedupKey = alertDeliveryHash(
        group.id,
        channel.id,
        group.nextFlushAt.toISOString(),
        ...notificationEvents.map((event) => event.id).sort(),
      );
      const inserted = await tx
        .insert(alertDeliveries)
        .values({
          dedupKey,
          organizationId: group.organizationId,
          notificationGroupId: group.id,
          channelId: channel.id,
          channelName: channel.name,
          notification,
        })
        .onConflictDoNothing()
        .returning({ dedupKey: alertDeliveries.dedupKey });
      if (inserted.length === 0) continue;
      await tx.insert(alertDeliveryEvents).values(
        notificationEvents.map((event) => ({
          organizationId: group.organizationId,
          deliveryDedupKey: dedupKey,
          eventId: event.id,
        })),
      );
      await addWorkerJobInTransaction(
        tx,
        ALERT_SEND_DELIVERY_TASK,
        { dedupKey },
        {
          jobKey: `${ALERT_SEND_DELIVERY_TASK}:${dedupKey}`,
          jobKeyMode: "replace",
          maxAttempts: ALERT_DELIVERY_MAX_ATTEMPTS,
        },
      );
    }
    const repeatAt =
      active.length > 0 && group.repeatIntervalSeconds
        ? new Date(Date.now() + group.repeatIntervalSeconds * 1_000)
        : null;
    await tx
      .update(alertNotificationGroups)
      .set({
        nextFlushAt: repeatAt ?? IDLE_GROUP_FLUSH_AT,
        lastFlushedAt: new Date(),
        lastNotifiedAt:
          notificationEvents.length > 0 ? new Date() : group.lastNotifiedAt,
        updatedAt: new Date(),
      })
      .where(eq(alertNotificationGroups.id, group.id));
    await tx
      .delete(alertNotificationGroupEvents)
      .where(eq(alertNotificationGroupEvents.groupId, group.id));
    if (active.length > 0) {
      await tx.insert(alertNotificationGroupEvents).values(
        active.map((event) => ({
          organizationId: group.organizationId,
          groupId: group.id,
          eventId: event.id,
        })),
      );
    }
    if (repeatAt) {
      await addWorkerJobInTransaction(
        tx,
        ALERT_FLUSH_GROUP_TASK,
        { groupId: group.id },
        {
          jobKey: `${ALERT_FLUSH_GROUP_TASK}:${group.id}:${repeatAt.toISOString()}`,
          jobKeyMode: "replace",
          maxAttempts: 5,
          queueName: alertingPartitionQueue("group", group.id),
          runAt: repeatAt,
        },
      );
    }
  });
}
