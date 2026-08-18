import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { CHANNEL_TEXT_MIN } from "@/data/alerting/delivery/channel-text-limits";
import { ALERT_DELIVERY_MAX_ATTEMPTS } from "@/data/alerting/delivery/config";
import {
  ALERT_SEND_DELIVERY_TASK,
  AlertGroupTaskPayloadSchema,
  enqueueFlushGroup,
  IDLE_GROUP_FLUSH_AT,
} from "@/data/alerting/delivery/tasks";
import { db } from "@/db/client";
import {
  alertChannels,
  alertDefaultChannels,
  alertDefinitions,
  alertDeliveries,
  alertDeliveryEvents,
  alertEvents,
  alertNotificationGroupEvents,
  alertNotificationGroups,
} from "@/db/schema";
import { truncateWithEllipsis } from "@/lib/truncate";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";
import { journalTerminalRow, recordAlertHistory } from "../history/clickhouse";
import {
  type GroupMember,
  groupNotificationPlan,
  instanceKey,
  memberVerdict,
  nextGroupFlushState,
} from "./grouping";
import { deliverableGroupMemberQuery } from "./journal-reader";
import {
  deferSuppressedEvent,
  loadActiveSilences,
  loadFiringInstanceKeys,
  matchSilence,
} from "./suppression";
import { alertDeliveryHash } from "./targeting";

// The body budgets against the tightest channel limit, keeping a margin for
// the title and url framing; the sender cuts the body further when a long
// url eats past the margin, never the url itself. No production path sets a
// url yet (ticket 28), so the margin is currently spent on the title alone. The title carries the full
// firing/resolved counts, so cutting lines never hides how big the group is.
const COMPOSE_FRAME_MARGIN = 200;
const BODY_MAX_CHARS = CHANNEL_TEXT_MIN - COMPOSE_FRAME_MARGIN;
export const BODY_MAX_EVENTS = 20;
const LINE_MAX_CHARS = 200;
// Room kept back for the "…and N more" line so appending it cannot overflow.
const OMITTED_LINE_RESERVE = 48;

// Bounds one flush's claimed membership set. Past this, a storm feeding one
// group (thousands of firing instances into one receiver) would push a
// single worker through a suppression check per member with no upper bound.
// Whatever is left past the cap stays linked and unflushed, and the pending
// count this flush already computes turns that into an immediate follow-up
// flush rather than a lost member.
export const FLUSH_GROUP_MEMBER_CLAIM_CAP = 500;

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
    const line = truncateWithEllipsis(full, LINE_MAX_CHARS);
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

async function directRuleChannels(
  organizationId: string,
  alertDefinitionId: string,
): Promise<{ channel: typeof alertChannels.$inferSelect }[]> {
  const [definition] = await db
    .select({ spec: alertDefinitions.spec })
    .from(alertDefinitions)
    .where(
      and(
        eq(alertDefinitions.organizationId, organizationId),
        eq(alertDefinitions.id, alertDefinitionId),
      ),
    )
    .limit(1);
  const names = definition?.spec.notifications?.channels ?? [];
  if (names.length === 0) return [];
  return db
    .select({ channel: alertChannels })
    .from(alertChannels)
    .where(
      and(
        eq(alertChannels.organizationId, organizationId),
        inArray(alertChannels.name, names),
      ),
    )
    .orderBy(asc(alertChannels.name));
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
    const rows = await deliverableGroupMemberQuery(
      tx,
      group.id,
      FLUSH_GROUP_MEMBER_CLAIM_CAP,
    );
    if (rows.length === 0) {
      // Nothing claimed: park on the idle sentinel instead of leaving
      // nextFlushAt in the past, or the next event dispatched to this group
      // would skip its whole group wait and page alone.
      await tx
        .update(alertNotificationGroups)
        .set({ nextFlushAt: IDLE_GROUP_FLUSH_AT, updatedAt: new Date() })
        .where(eq(alertNotificationGroups.id, group.id));
      return null;
    }
    return { group, rows };
  });
  if (!claimed) return;
  const { group, rows } = claimed;
  // Only these memberships are this flush's to remove. Anything added while
  // suppression is evaluated below belongs to the next flush.
  const claimedEventIds = new Set(rows.map(({ event }) => event.id));
  const members: GroupMember<(typeof rows)[number]["event"]>[] = [];
  // A member whose rule was paused or deleted, or whose instance has stopped
  // firing, must not notify. Its membership stays in the claimed set, so the
  // committing delete below removes it; a member that never made a
  // notification also gets its terminal suppression row so its chain does not
  // dangle. See `memberVerdict` for why live instance state, not the
  // membership row, is what decides.
  const droppedRows: {
    row: (typeof rows)[number];
    reason: NonNullable<ReturnType<typeof memberVerdict>["terminal"]>;
  }[] = [];
  const candidateRows: typeof rows = [];
  const firingKeys = await loadFiringInstanceKeys(
    group.organizationId,
    rows
      .filter(({ event }) => event.eventType !== "instance_resolved")
      .map(({ event }) => event),
  );
  const resolvedKeys = new Set(
    rows
      .filter(({ event }) => event.eventType === "instance_resolved")
      .map(({ event }) => instanceKey(event)),
  );
  for (const row of rows) {
    const key = instanceKey(row.event);
    const verdict = memberVerdict({
      ruleActive: row.ruleActive,
      eventType: row.event.eventType,
      flushedAt: row.flushedAt,
      instanceFiring: firingKeys.has(key),
      resolveInBatch: resolvedKeys.has(key),
    });
    if (verdict.deliverable) {
      candidateRows.push(row);
      continue;
    }
    if (verdict.terminal) droppedRows.push({ row, reason: verdict.terminal });
  }
  // Loaded once for the whole flush, not once per member: matchingSilence
  // ran an org-wide scan, so a flush with hundreds of members used to issue
  // hundreds of identical scans.
  const now = new Date();
  const silences =
    candidateRows.length > 0
      ? await loadActiveSilences(group.organizationId, now)
      : [];
  for (const row of candidateRows) {
    const { event, flushedAt } = row;
    const silence = matchSilence(event, silences, now);
    if (silence) {
      await deferSuppressedEvent(event, silence, now);
      // Drop the membership now and disown the id. Deferral reschedules
      // processing, which re-adds the membership, and this loop can outlast
      // that. Still owning the id would make the commit below delete that
      // fresh row.
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
    if (event.silenceId) {
      await db
        .update(alertEvents)
        .set({ silenceId: null })
        .where(eq(alertEvents.id, event.id));
    }
    members.push({ event, flushedAt });
  }
  const {
    active,
    notify: notificationEvents,
    droppedUnannounced,
  } = groupNotificationPlan(members);
  // A direct group's channels resolve by name at flush time: the rule's spec
  // is the truth for what it declared, and only the names that exist as
  // channels right now deliver. A name with no channel simply drops out, the
  // same as if the spec had never mentioned it.
  const channels = group.directAlertDefinitionId
    ? await directRuleChannels(
        group.organizationId,
        group.directAlertDefinitionId,
      )
    : group.defaultTier
      ? await db
          .select({ channel: alertChannels })
          .from(alertDefaultChannels)
          .innerJoin(
            alertChannels,
            and(
              eq(
                alertDefaultChannels.organizationId,
                alertChannels.organizationId,
              ),
              eq(alertDefaultChannels.channelId, alertChannels.id),
            ),
          )
          .where(
            and(
              eq(alertDefaultChannels.organizationId, group.organizationId),
              eq(alertDefaultChannels.tier, group.defaultTier),
            ),
          )
          .orderBy(asc(alertChannels.name))
      : [];
  // A notification-worthy set with nowhere to send it: the flush below still
  // marks these members flushed, so without a
  // terminal here their chains would read as delivered with no record of why
  // nothing went out. Guarded on repo-level channel requirements today, but
  // the invariant ("chains end in an outcome") must hold regardless.
  const noChannelDrops =
    channels.length === 0 && notificationEvents.length > 0
      ? notificationEvents
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
    const dedupEventIds = notificationEvents.map((event) => event.id).sort();
    for (const { channel } of notificationEvents.length > 0 ? channels : []) {
      const dedupKey = alertDeliveryHash(
        group.id,
        channel.id,
        group.nextFlushAt.toISOString(),
        ...dedupEventIds,
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
    const { nextFlushAt, enqueue } = nextGroupFlushState({
      // Re-notification of still-firing alerts is off by design: a repeat
      // would need a knob, and the fixed model has none.
      repeatAt: null,
      pendingFlushAt: fresh.nextFlushAt,
      hasUnflushedMembers: (pending?.unflushed ?? 0) > 0,
      now: flushedAt,
    });
    await tx
      .update(alertNotificationGroups)
      .set({
        nextFlushAt,
        lastFlushedAt: flushedAt,
        updatedAt: flushedAt,
      })
      .where(eq(alertNotificationGroups.id, group.id));
    if (enqueue) {
      await enqueueFlushGroup(tx, group.id, nextFlushAt);
    }
  });
  if (
    droppedRows.length > 0 ||
    droppedUnannounced.length > 0 ||
    noChannelDrops.length > 0
  ) {
    await recordAlertHistory(
      null,
      [
        ...droppedRows.map(({ row: { event }, reason }) =>
          journalTerminalRow(event, { reason }),
        ),
        // A resolve whose fire never went out: nobody was ever told this
        // instance was firing, so the resolve does not notify either, but its
        // chain still needs a terminal so it does not read as forever in
        // flight.
        ...droppedUnannounced.map((event) => journalTerminalRow(event)),
        // A rule or tier with no channels attached: nothing was sent, but
        // the flush still marked these flushed.
        ...noChannelDrops.map((event) =>
          journalTerminalRow(event, { reason: "no_channels" }),
        ),
      ],
      { convergesOnRetry: true },
    );
  }
}
