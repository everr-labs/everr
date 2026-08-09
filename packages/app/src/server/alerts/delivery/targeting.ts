import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  ALERTING_DEFAULT_GROUP_BY,
  ALERTING_DEFAULT_GROUP_INTERVAL_SECS,
  ALERTING_DEFAULT_GROUP_WAIT_SECS,
} from "@/data/alerting/routing/defaults";
import {
  alertingSelectRoutes,
  alertingSyntheticLabels,
} from "@/data/alerting/routing/resolution";
import type { AlertingRoute } from "@/data/alerting/types";
import { db } from "@/db/client";
import {
  alertDefinitionChannels,
  type alertEvents,
  alertReceivers,
  alertRoutes,
} from "@/db/schema";

function stableJson(value: Record<string, string>) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

export function alertDeliveryHash(...parts: string[]) {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

export function alertEventDispatchLabels(
  event: typeof alertEvents.$inferSelect,
) {
  return alertingSyntheticLabels(event.instanceLabels, {
    severity: event.severity,
    status: event.eventType === "instance_resolved" ? "resolved" : "firing",
    rule: event.sourceDefinitionId,
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

export type DispatchTarget = {
  receiverId: string | null;
  directAlertDefinitionId: string | null;
  groupKey: string;
  groupLabels: Record<string, string>;
  groupWaitSeconds: number;
  groupIntervalSeconds: number;
  repeatIntervalSeconds: number | null;
};

async function directDispatchTarget(
  event: typeof alertEvents.$inferSelect,
): Promise<DispatchTarget | null> {
  const [destination] = await db
    .select({ channelId: alertDefinitionChannels.channelId })
    .from(alertDefinitionChannels)
    .where(
      and(
        eq(alertDefinitionChannels.organizationId, event.organizationId),
        eq(alertDefinitionChannels.alertDefinitionId, event.sourceDefinitionId),
      ),
    )
    .limit(1);
  if (!destination) return null;

  const labels = alertEventDispatchLabels(event);
  const groupLabels = Object.fromEntries(
    ALERTING_DEFAULT_GROUP_BY.map((key) => [key, labels[key] ?? ""]),
  );
  return {
    receiverId: null,
    directAlertDefinitionId: event.sourceDefinitionId,
    groupKey: alertDeliveryHash(
      "direct",
      event.sourceDefinitionId,
      stableJson(groupLabels),
    ),
    groupLabels,
    groupWaitSeconds: ALERTING_DEFAULT_GROUP_WAIT_SECS,
    groupIntervalSeconds: ALERTING_DEFAULT_GROUP_INTERVAL_SECS,
    repeatIntervalSeconds: null,
  };
}

async function routedDispatchTargets(
  event: typeof alertEvents.$inferSelect,
): Promise<DispatchTarget[]> {
  const routes = alertingSelectRoutes(
    await loadRoutes(event.organizationId),
    alertEventDispatchLabels(event),
  );
  const targets: DispatchTarget[] = [];
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
    const labels = alertEventDispatchLabels(event);
    const groupLabels = Object.fromEntries(
      (route.group_by ?? []).map((key) => [key, labels[key] ?? ""]),
    );
    targets.push({
      receiverId: receiver.id,
      directAlertDefinitionId: null,
      groupKey: alertDeliveryHash(receiver.id, stableJson(groupLabels)),
      groupLabels,
      groupWaitSeconds: route.group_wait_secs ?? 30,
      groupIntervalSeconds: route.group_interval_secs ?? 300,
      repeatIntervalSeconds: route.repeat_interval_secs,
    });
  }
  return targets;
}

export async function selectDispatchTargets<T>(
  directTarget: T | null,
  routedTargets: () => Promise<T[]>,
): Promise<T[]> {
  return directTarget ? [directTarget] : routedTargets();
}

export async function dispatchTargetsForEvent(
  event: typeof alertEvents.$inferSelect,
): Promise<DispatchTarget[]> {
  const directTarget = await directDispatchTarget(event);
  return selectDispatchTargets(directTarget, () =>
    routedDispatchTargets(event),
  );
}
