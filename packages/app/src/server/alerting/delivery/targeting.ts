import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  ALERTING_DEFAULT_GROUP_BY,
  type AlertingDefaultTier,
} from "@/data/alerting/routing/defaults";
import { alertingSyntheticLabels } from "@/data/alerting/routing/resolution";
import { db } from "@/db/client";
import {
  alertDefaultChannels,
  alertDefinitions,
  type alertEvents,
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

export type DispatchTarget = {
  defaultTier: AlertingDefaultTier | null;
  directAlertDefinitionId: string | null;
  groupKey: string;
  groupLabels: Record<string, string>;
};

function groupLabelsFor(event: typeof alertEvents.$inferSelect) {
  const labels = alertEventDispatchLabels(event);
  return Object.fromEntries(
    ALERTING_DEFAULT_GROUP_BY.map((key) => [key, labels[key] ?? ""]),
  );
}

async function directDispatchTarget(
  event: typeof alertEvents.$inferSelect,
): Promise<DispatchTarget | null> {
  // Declared, not resolved: a rule that names channels is a direct target
  // even while none of those names exist yet. The flush resolves the names
  // and records a no-channel terminal when nothing matches, rather than the
  // rule silently rejoining the default destination.
  const [definition] = await db
    .select({ spec: alertDefinitions.spec })
    .from(alertDefinitions)
    .where(
      and(
        eq(alertDefinitions.organizationId, event.organizationId),
        eq(alertDefinitions.id, event.sourceDefinitionId),
      ),
    )
    .limit(1);
  if ((definition?.spec.notifications?.channels ?? []).length === 0)
    return null;

  const groupLabels = groupLabelsFor(event);
  return {
    defaultTier: null,
    directAlertDefinitionId: event.sourceDefinitionId,
    groupKey: alertDeliveryHash(
      "direct",
      event.sourceDefinitionId,
      stableJson(groupLabels),
    ),
    groupLabels,
  };
}

/**
 * The default-destination tier this event delivers to: the "all" tier when
 * the org has not split by severity, else the event's own severity tier. A
 * tier that exists but currently has no channels still resolves — the flush
 * ends the chain with a `no_channels` terminal, matching how every other
 * config gap is recorded rather than silently dropped.
 */
async function defaultDispatchTarget(
  event: typeof alertEvents.$inferSelect,
): Promise<DispatchTarget | null> {
  const tiers = await db
    .selectDistinct({ tier: alertDefaultChannels.tier })
    .from(alertDefaultChannels)
    .where(
      and(
        eq(alertDefaultChannels.organizationId, event.organizationId),
        inArray(alertDefaultChannels.tier, ["all", event.severity]),
      ),
    );
  const tier = tiers.some((row) => row.tier === "all")
    ? ("all" as const)
    : tiers.length > 0
      ? event.severity
      : null;
  if (tier === null) return null;

  const groupLabels = groupLabelsFor(event);
  return {
    defaultTier: tier,
    directAlertDefinitionId: null,
    groupKey: alertDeliveryHash("default", tier, stableJson(groupLabels)),
    groupLabels,
  };
}

export async function dispatchTargetsForEvent(
  event: typeof alertEvents.$inferSelect,
): Promise<DispatchTarget[]> {
  // A rule naming its own channels opts out of the default destination.
  const direct = await directDispatchTarget(event);
  if (direct) return [direct];
  const fallback = await defaultDispatchTarget(event);
  return fallback ? [fallback] : [];
}
