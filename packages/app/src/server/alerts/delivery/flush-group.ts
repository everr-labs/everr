import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
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
import { CHANNEL_TEXT_MAX } from "@/lib/channel-text-limits";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";
import {
  historyDefFromJournalRow,
  recordAlertHistory,
  suppressionHistoryRow,
} from "../history/clickhouse";
import { ALERT_DELIVERY_MAX_ATTEMPTS } from "./config";
import {
  type GroupMember,
  groupNotificationPlan,
  memberLiveness,
  nextGroupFlushState,
} from "./grouping";
import { deliverableGroupMemberQuery } from "./journal-reader";
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
} from "./tasks";

// The body budgets against the tightest channel limit, keeping a margin for
// the title and url framing; the sender cuts the body further when a long
// url eats past the margin, never the url itself. The title carries the full
// firing/resolved counts, so cutting lines never hides how big the group is.
const COMPOSE_FRAME_MARGIN = 200;
const BODY_MAX_CHARS = CHANNEL_TEXT_MAX.discord - COMPOSE_FRAME_MARGIN;
const BODY_MAX_EVENTS = 20;
const LINE_MAX_CHARS = 200;
// Room kept back for the "…and N more" line so appending it cannot overflow.
const OMITTED_LINE_RESERVE = 48;

export type NotificationEvent = Pick<
  typeof alertEvents.$inferSelect,
  | "eventType"
  | "slug"
  | "instanceLabels"
  | "notificationTitle"
  | "notificationDescription"
>;

export function formatNotification(events: NotificationEvent[]) {
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
  const lines: string[] = [];
  let used = 0;
  for (const event of events) {
    if (lines.length >= BODY_MAX_EVENTS) break;
    const labels = Object.entries(event.instanceLabels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(", ");
    const heading = event.notificationTitle || event.slug;
    const detail = event.notificationDescription
      ? `: ${event.notificationDescription}`
      : "";
    const full = `${event.eventType === "instance_resolved" ? "Resolved" : "Firing"}: ${heading}${labels ? ` (${labels})` : ""}${detail}`;
    const line =
      full.length > LINE_MAX_CHARS
        ? `${full.slice(0, LINE_MAX_CHARS - 1)}…`
        : full;
    const cost = line.length + (lines.length > 0 ? 1 : 0);
    if (used + cost > BODY_MAX_CHARS - OMITTED_LINE_RESERVE) break;
    lines.push(line);
    used += cost;
  }
  const omitted = events.length - lines.length;
  if (omitted > 0) {
    lines.push(`…and ${omitted} more events in this group`);
  }
  return { title: `Everr alert: ${title}`, body: lines.join("\n") };
}

export async function flushAlertGroup(rawPayload: unknown): Promise<void> {
  const { groupId } = AlertGroupTaskPayloadSchema.parse(rawPayload);
  // Claim under the same lock processAlertEvent takes. Without it, a
  // membership inserted between this read and the delete below is destroyed by
  // a delete built from a stale snapshot, and its event is never delivered.
  const claimed = await db.transaction(async (tx) => {
    const [group] = await tx
      .select()
      .from(alertNotificationGroups)
      .where(eq(alertNotificationGroups.id, groupId))
      .for("update")
      .limit(1);
    if (!group || group.nextFlushAt > new Date()) return null;
    const rows = await deliverableGroupMemberQuery(tx, group.id);
    return rows.length === 0 ? null : { group, rows };
  });
  if (!claimed) return;
  const { group, rows } = claimed;
  // Only these memberships are this flush's to remove. Anything added while
  // suppression is evaluated below belongs to the next flush.
  const claimedEventIds = new Set(rows.map(({ event }) => event.id));
  const members: GroupMember<(typeof rows)[number]["event"]>[] = [];
  // A member whose rule was paused or deleted after it joined the group must
  // not notify. Its membership stays in the claimed set, so the committing
  // delete below removes it; a member that never made a notification also
  // gets its terminal suppression row so its chain does not dangle.
  const droppedRows: typeof rows = [];
  for (const row of rows) {
    const { event, flushedAt, ruleActive } = row;
    // Muted chains sit outside the terminal surface: history consumers filter
    // `rule_muted = false`, so a muted member is neither notified nor closed.
    if (event.suppressed) continue;
    const liveness = memberLiveness(ruleActive, flushedAt);
    if (liveness === "dropped_unnotified") {
      droppedRows.push(row);
      continue;
    }
    if (liveness !== "deliverable") continue;
    const now = new Date();
    const silence = await matchingSilence(event, now);
    const inhibited = silence ? false : await isInhibited(event);
    if (silence || inhibited) {
      await deferSuppressedEvent(event, silence, inhibited, now);
      // Drop the membership now and disown the id. Deferral reschedules
      // processing, which re-adds the membership; the inhibition path
      // reschedules only 60 seconds out, and this loop can outlast that. Still
      // owning the id would make the commit below delete that fresh row.
      await db
        .delete(alertNotificationGroupEvents)
        .where(
          and(
            eq(alertNotificationGroupEvents.groupId, group.id),
            eq(alertNotificationGroupEvents.eventId, event.id),
          ),
        );
      claimedEventIds.delete(event.id);
      continue;
    }
    if (event.silenced || event.inhibited || event.silenceId) {
      await db
        .update(alertEvents)
        .set({ silenced: false, inhibited: false, silenceId: null })
        .where(eq(alertEvents.id, event.id));
    }
    members.push({ event, flushedAt });
  }
  const { active, notify: notificationEvents } = groupNotificationPlan(members);
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
    // Re-read under lock: another writer may have moved nextFlushAt while this
    // flush was evaluating suppression, and that schedule must not be lost.
    const [fresh] = await tx
      .select()
      .from(alertNotificationGroups)
      .where(eq(alertNotificationGroups.id, group.id))
      .for("update")
      .limit(1);
    if (!fresh) return;
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
    const flushedAt = new Date();
    if (claimedEventIds.size > 0) {
      await tx
        .delete(alertNotificationGroupEvents)
        .where(
          and(
            eq(alertNotificationGroupEvents.groupId, group.id),
            inArray(alertNotificationGroupEvents.eventId, [...claimedEventIds]),
          ),
        );
    }
    if (active.length > 0) {
      // `active` is always a subset of what was notified, so every row
      // reinserted here has been through this flush.
      await tx.insert(alertNotificationGroupEvents).values(
        active.map((event) => ({
          organizationId: group.organizationId,
          groupId: group.id,
          eventId: event.id,
          flushedAt,
        })),
      );
    }
    const [pending] = await tx
      .select({ unflushed: count() })
      .from(alertNotificationGroupEvents)
      .where(
        and(
          eq(alertNotificationGroupEvents.groupId, group.id),
          isNull(alertNotificationGroupEvents.flushedAt),
        ),
      );
    const repeatAt =
      active.length > 0 && group.repeatIntervalSeconds
        ? new Date(flushedAt.getTime() + group.repeatIntervalSeconds * 1_000)
        : null;
    const { nextFlushAt, enqueue } = nextGroupFlushState({
      repeatAt,
      pendingFlushAt: fresh.nextFlushAt,
      hasUnflushedMembers: (pending?.unflushed ?? 0) > 0,
      now: flushedAt,
    });
    await tx
      .update(alertNotificationGroups)
      .set({
        nextFlushAt,
        lastFlushedAt: flushedAt,
        lastNotifiedAt:
          notificationEvents.length > 0 ? flushedAt : group.lastNotifiedAt,
        updatedAt: flushedAt,
      })
      .where(eq(alertNotificationGroups.id, group.id));
    if (enqueue) {
      await addWorkerJobInTransaction(
        tx,
        ALERT_FLUSH_GROUP_TASK,
        { groupId: group.id },
        {
          jobKey: `${ALERT_FLUSH_GROUP_TASK}:${group.id}:${nextFlushAt.toISOString()}`,
          jobKeyMode: "replace",
          maxAttempts: 5,
          queueName: alertingPartitionQueue("group", group.id),
          runAt: nextFlushAt,
        },
      );
    }
  });
  if (droppedRows.length > 0) {
    const decidedAt = new Date();
    await recordAlertHistory(
      null,
      droppedRows.map(({ event, ruleActive }) =>
        suppressionHistoryRow({
          def: historyDefFromJournalRow(event),
          notificationEventId: event.id,
          occurredAt: decidedAt,
          fingerprint: event.instanceFingerprint,
          labels: event.instanceLabels,
          silenced: false,
          inhibited: false,
          silenceId: null,
          reason: ruleActive === null ? "rule_deleted" : "rule_paused",
        }),
      ),
    );
  }
}
