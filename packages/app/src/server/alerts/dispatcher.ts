import { createHash } from "node:crypto";
import { and, asc, eq, gt, lte } from "drizzle-orm";
import { z } from "zod";
import {
  alertingMatchingSilence,
  alertingRouteMatches,
  alertingSelectRoutes,
  alertingSyntheticLabels,
} from "@/data/alerting/route-resolution";
import {
  ALERTING_CANONICAL_SLO_TIERS,
  alertingSloTierSeverity,
} from "@/data/alerting/slo";
import type { AlertingRoute } from "@/data/alerting/types";
import { db } from "@/db/client";
import {
  alertChannels,
  alertDefinitions,
  alertDeliveries,
  alertDeliveryEvents,
  alertEvents,
  alertInhibitions,
  alertInstances,
  alertNotificationGroupEvents,
  alertNotificationGroups,
  alertReceiverChannels,
  alertReceivers,
  alertRoutes,
  alertSilences,
  sloAlertInstances,
  sloDefinitions,
} from "@/db/schema";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";
import { errorMessage } from "@/telemetry/logger";
import { alertingPartitionQueue } from "./01-scanner";
import { decryptChannelConfig } from "./channel-secrets";
import { sendChannelNotification } from "./channels";
import { ALERT_DELIVERY_MAX_ATTEMPTS } from "./config";
import { nextGroupFlushAt } from "./grouping";

export const ALERT_PROCESS_EVENT_TASK = "alerts/process-event";
export const ALERT_FLUSH_GROUP_TASK = "alerts/flush-group";
export const ALERT_SEND_DELIVERY_TASK = "alerts/send-delivery";

const EventPayloadSchema = z.object({ eventId: z.string().uuid() });
const GroupPayloadSchema = z.object({ groupId: z.string().uuid() });
const DeliveryPayloadSchema = z.object({ dedupKey: z.string().min(1) });
const IDLE_GROUP_FLUSH_AT = new Date("9999-12-31T23:59:59.999Z");

function stableJson(value: Record<string, string>) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

function hash(...parts: string[]) {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function eventLabels(event: typeof alertEvents.$inferSelect) {
  return alertingSyntheticLabels(event.instanceLabels, {
    severity: event.severity,
    status: event.eventType === "instance_resolved" ? "resolved" : "firing",
    rule: event.sourceDefinitionId,
    ...(event.sourceKind === "slo" ? { slo: event.sourceDefinitionId } : {}),
  });
}

async function matchingSilence(
  event: typeof alertEvents.$inferSelect,
  now: Date,
) {
  const silences = await db
    .select()
    .from(alertSilences)
    .where(
      and(
        eq(alertSilences.organizationId, event.organizationId),
        lte(alertSilences.startsAt, now),
        gt(alertSilences.endsAt, now),
      ),
    );
  return alertingMatchingSilence(
    eventLabels(event),
    silences.map((silence) => ({
      ...silence,
      starts_at: silence.startsAt.toISOString(),
      ends_at: silence.endsAt.toISOString(),
    })),
    now.getTime(),
  );
}

async function eventStillFiring(event: typeof alertEvents.$inferSelect) {
  if (event.eventType === "instance_resolved") return false;
  if (event.sourceKind === "alert") {
    const [row] = await db
      .select({ id: alertInstances.id })
      .from(alertInstances)
      .where(
        and(
          eq(alertInstances.organizationId, event.organizationId),
          eq(alertInstances.alertDefinitionId, event.sourceDefinitionId),
          eq(alertInstances.fingerprint, event.instanceFingerprint),
          eq(alertInstances.status, "firing"),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
  if (event.sourceKind === "slo") {
    const [row] = await db
      .select({ id: sloAlertInstances.id })
      .from(sloAlertInstances)
      .where(
        and(
          eq(sloAlertInstances.organizationId, event.organizationId),
          eq(sloAlertInstances.sloDefinitionId, event.sourceDefinitionId),
          eq(sloAlertInstances.tier, event.instanceFingerprint),
          eq(sloAlertInstances.status, "firing"),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
  return false;
}

async function deferSuppressedEvent(
  event: typeof alertEvents.$inferSelect,
  silence: Awaited<ReturnType<typeof matchingSilence>>,
  inhibited: boolean,
  now: Date,
) {
  const shouldRetry =
    event.eventType !== "instance_resolved" && (await eventStillFiring(event));
  await db.transaction(async (tx) => {
    await tx
      .update(alertEvents)
      .set({
        silenced: Boolean(silence),
        silenceId: silence?.id ?? null,
        inhibited,
        processedAt: shouldRetry ? null : now,
      })
      .where(eq(alertEvents.id, event.id));
    if (!shouldRetry) return;
    const runAt = silence
      ? new Date(silence.ends_at)
      : new Date(now.getTime() + 60_000);
    await addWorkerJobInTransaction(
      tx,
      ALERT_PROCESS_EVENT_TASK,
      { eventId: event.id },
      {
        jobKey: `${ALERT_PROCESS_EVENT_TASK}:${event.id}:${runAt.toISOString()}`,
        jobKeyMode: "replace",
        maxAttempts: 5,
        runAt,
      },
    );
  });
}

async function isInhibited(event: typeof alertEvents.$inferSelect) {
  if (event.eventType === "instance_resolved") return false;
  const inhibitions = await db
    .select()
    .from(alertInhibitions)
    .where(eq(alertInhibitions.organizationId, event.organizationId));
  const [ruleSources, sloSources] = await Promise.all([
    db
      .select({ instance: alertInstances, def: alertDefinitions })
      .from(alertInstances)
      .innerJoin(
        alertDefinitions,
        eq(alertInstances.alertDefinitionId, alertDefinitions.id),
      )
      .where(
        and(
          eq(alertInstances.organizationId, event.organizationId),
          eq(alertInstances.status, "firing"),
        ),
      ),
    db
      .select({ instance: sloAlertInstances, slo: sloDefinitions })
      .from(sloAlertInstances)
      .innerJoin(
        sloDefinitions,
        eq(sloAlertInstances.sloDefinitionId, sloDefinitions.id),
      )
      .where(
        and(
          eq(sloAlertInstances.organizationId, event.organizationId),
          eq(sloAlertInstances.status, "firing"),
        ),
      ),
  ]);
  const sources = [
    ...ruleSources.map(({ instance, def }) =>
      alertingSyntheticLabels(instance.labels, {
        severity: def.spec.severity,
        status: "firing",
        rule: def.id,
      }),
    ),
    ...sloSources.map(({ instance, slo }) =>
      alertingSyntheticLabels(instance.labels, {
        severity: alertingSloTierSeverity(
          ALERTING_CANONICAL_SLO_TIERS,
          instance.labels,
        ),
        status: "firing",
        rule: slo.id,
        slo: slo.id,
      }),
    ),
  ];
  const target = eventLabels(event);
  if (
    event.sourceKind === "slo" &&
    event.instanceLabels.slo_tier === "ticket" &&
    sloSources.some(
      ({ instance, slo }) =>
        slo.id === event.sourceDefinitionId &&
        alertingSloTierSeverity(
          ALERTING_CANONICAL_SLO_TIERS,
          instance.labels,
        ) === "critical",
    )
  ) {
    return true;
  }
  return inhibitions.some(({ config }) => {
    if (!alertingRouteMatches(config.target_matchers, target)) return false;
    return sources.some((source) => {
      return (
        alertingRouteMatches(config.source_matchers, source) &&
        config.equal.every((key) => (source[key] ?? "") === (target[key] ?? ""))
      );
    });
  });
}

async function loadRoutes(organizationId: string): Promise<AlertingRoute[]> {
  const rows = await db
    .select({ route: alertRoutes, receiver: alertReceivers.name })
    .from(alertRoutes)
    .innerJoin(alertReceivers, eq(alertRoutes.receiverId, alertReceivers.id))
    .where(eq(alertRoutes.organizationId, organizationId));
  return rows.map(({ route, receiver }) => ({
    id: route.id,
    tenant: organizationId,
    receiver,
    priority: route.priority,
    ...route.config,
  }));
}

export async function processAlertEvent(rawPayload: unknown): Promise<void> {
  const { eventId } = EventPayloadSchema.parse(rawPayload);
  const [event] = await db
    .select()
    .from(alertEvents)
    .where(eq(alertEvents.id, eventId))
    .limit(1);
  if (!event || event.processedAt) return;
  const now = new Date();
  if (event.suppressed) {
    await db
      .update(alertEvents)
      .set({ processedAt: now })
      .where(eq(alertEvents.id, event.id));
    return;
  }
  if (
    event.eventType !== "instance_resolved" &&
    !(await eventStillFiring(event))
  ) {
    await db
      .update(alertEvents)
      .set({ processedAt: now })
      .where(eq(alertEvents.id, event.id));
    return;
  }
  const silence = await matchingSilence(event, now);
  const inhibited = silence ? false : await isInhibited(event);
  if (silence || inhibited) {
    await deferSuppressedEvent(event, silence, inhibited, now);
    return;
  }
  if (event.silenced || event.inhibited || event.silenceId) {
    await db
      .update(alertEvents)
      .set({ silenced: false, inhibited: false, silenceId: null })
      .where(eq(alertEvents.id, event.id));
  }

  const routes = alertingSelectRoutes(
    await loadRoutes(event.organizationId),
    eventLabels(event),
  );
  for (const route of routes) {
    const [receiver] = await db
      .select()
      .from(alertReceivers)
      .where(
        and(
          eq(alertReceivers.organizationId, event.organizationId),
          eq(alertReceivers.name, route.receiver),
        ),
      )
      .limit(1);
    if (!receiver) continue;
    const groupLabels = Object.fromEntries(
      (route.group_by ?? []).map((key) => [key, eventLabels(event)[key] ?? ""]),
    );
    const groupKey = hash(receiver.id, stableJson(groupLabels));
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(alertNotificationGroups)
        .where(
          and(
            eq(alertNotificationGroups.organizationId, event.organizationId),
            eq(alertNotificationGroups.groupKey, groupKey),
          ),
        )
        .for("update")
        .limit(1);
      const groupWait = route.group_wait_secs ?? 30;
      const groupInterval = route.group_interval_secs ?? 300;
      const nextFlushAt = nextGroupFlushAt(
        existing
          ? {
              nextFlushAt: existing.nextFlushAt,
              lastFlushedAt: existing.lastFlushedAt,
            }
          : null,
        now,
        groupWait,
        groupInterval,
      );
      const [group] = existing
        ? await tx
            .update(alertNotificationGroups)
            .set({
              nextFlushAt,
              repeatIntervalSeconds: route.repeat_interval_secs,
              updatedAt: now,
            })
            .where(eq(alertNotificationGroups.id, existing.id))
            .returning()
        : await tx
            .insert(alertNotificationGroups)
            .values({
              organizationId: event.organizationId,
              groupKey,
              receiverId: receiver.id,
              labels: groupLabels,
              nextFlushAt,
              repeatIntervalSeconds: route.repeat_interval_secs,
            })
            .returning();
      await tx
        .insert(alertNotificationGroupEvents)
        .values({
          organizationId: event.organizationId,
          groupId: group.id,
          eventId: event.id,
        })
        .onConflictDoNothing();
      await addWorkerJobInTransaction(
        tx,
        ALERT_FLUSH_GROUP_TASK,
        { groupId: group.id },
        {
          jobKey: `${ALERT_FLUSH_GROUP_TASK}:${group.id}:${nextFlushAt.toISOString()}:${event.id}`,
          jobKeyMode: "replace",
          maxAttempts: 5,
          queueName: alertingPartitionQueue("group", group.id),
          runAt: nextFlushAt,
        },
      );
    });
  }
  await db
    .update(alertEvents)
    .set({ processedAt: now })
    .where(eq(alertEvents.id, event.id));
}

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
  const { groupId } = GroupPayloadSchema.parse(rawPayload);
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
  const channels = await db
    .select({ channel: alertChannels })
    .from(alertReceiverChannels)
    .innerJoin(
      alertChannels,
      and(
        eq(alertReceiverChannels.organizationId, alertChannels.organizationId),
        eq(alertReceiverChannels.channelId, alertChannels.id),
      ),
    )
    .where(
      and(
        eq(alertReceiverChannels.organizationId, group.organizationId),
        eq(alertReceiverChannels.receiverId, group.receiverId),
      ),
    )
    .orderBy(asc(alertReceiverChannels.position));
  const notification = formatNotification(notificationEvents);
  await db.transaction(async (tx) => {
    for (const { channel } of notificationEvents.length > 0 ? channels : []) {
      const dedupKey = hash(
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

export async function sendAlertDelivery(rawPayload: unknown): Promise<void> {
  const { dedupKey } = DeliveryPayloadSchema.parse(rawPayload);
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
