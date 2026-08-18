import { randomUUID } from "node:crypto";
import { and, asc, countDistinct, eq, inArray, sql } from "drizzle-orm";
import { deliveryIsInFlight } from "@/data/alerting/delivery/config";
import type { AlertingDefaultTier } from "@/data/alerting/routing/defaults";
import { type DbExecutor, db } from "@/db/client";
import {
  alertChannels,
  alertDefaultChannels,
  alertDefinitionChannels,
  alertDeliveries,
} from "@/db/schema";
import {
  throwAlertingPersistenceError,
  translateAlertingConflict,
} from "../persistence";
import {
  AlertingChannelConfigSchema,
  AlertingDefaultDestinationInputSchema,
} from "../schema";
import type { AlertingMutationScope } from "../session";
import type {
  AlertingChannelConfig,
  AlertingDefaultDestinationInput,
} from "../types";
import {
  decryptChannelConfig,
  encryptChannelConfig,
  redactChannelConfig,
  retainRedactedChannelSecrets,
} from "./channel-secrets.server";

function channelView(row: typeof alertChannels.$inferSelect) {
  return {
    id: row.id,
    tenant: row.organizationId,
    name: row.name,
    config: redactChannelConfig(
      decryptChannelConfig(row.organizationId, row.id, row.encryptedConfig),
    ),
  };
}

export async function listChannels(
  organizationId: string,
  executor: DbExecutor = db,
) {
  const rows = await executor
    .select()
    .from(alertChannels)
    .where(eq(alertChannels.organizationId, organizationId))
    .orderBy(asc(alertChannels.name));
  return rows.map(channelView);
}

export async function createChannel(
  { organizationId }: AlertingMutationScope,
  body: { name: string; config: AlertingChannelConfig },
) {
  const id = randomUUID();
  const config = AlertingChannelConfigSchema.parse(body.config);
  const [row] = await translateAlertingConflict(() =>
    db
      .insert(alertChannels)
      .values({
        id,
        organizationId,
        name: body.name,
        encryptedConfig: encryptChannelConfig(organizationId, id, config),
      })
      .returning(),
  );
  // The first channel becomes the default destination, so one create is a
  // complete delivery setup. Racing creates collide on the position unique
  // index; losing that race means a default already exists, which is fine.
  if (!(await hasDefaultDestination(organizationId))) {
    await db
      .insert(alertDefaultChannels)
      .values({ organizationId, tier: "all", channelId: id, position: 0 })
      .onConflictDoNothing();
  }
  return channelView(row);
}

async function getChannelRow(organizationId: string, name: string) {
  const [row] = await db
    .select()
    .from(alertChannels)
    .where(
      and(
        eq(alertChannels.organizationId, organizationId),
        eq(alertChannels.name, name),
      ),
    )
    .limit(1);
  if (!row) {
    throwAlertingPersistenceError(
      404,
      "not_found",
      `Channel not found: ${name}`,
    );
  }
  return row;
}

export async function updateChannel(
  { organizationId }: AlertingMutationScope,
  name: string,
  body: { name?: string; config: AlertingChannelConfig },
) {
  const previous = await getChannelRow(organizationId, name);
  const previousConfig = decryptChannelConfig(
    organizationId,
    previous.id,
    previous.encryptedConfig,
  );
  const nextConfig = retainRedactedChannelSecrets(
    AlertingChannelConfigSchema.parse(body.config),
    previousConfig,
  );
  const [row] = await translateAlertingConflict(() =>
    db
      .update(alertChannels)
      .set({
        name: body.name ?? name,
        encryptedConfig: encryptChannelConfig(
          organizationId,
          previous.id,
          nextConfig,
        ),
        updatedAt: new Date(),
      })
      .where(eq(alertChannels.id, previous.id))
      .returning(),
  );
  return channelView(row);
}

export async function deleteChannel(
  { organizationId }: AlertingMutationScope,
  name: string,
) {
  const channel = await getChannelRow(organizationId, name);
  // One transaction: a flush that inserts a delivery for this channel between
  // the count and the delete would otherwise slip past the guard. It can still
  // land between the update and the delete, and then the foreign key rejects
  // the delete and the whole thing rolls back, which is the safe direction.
  await db.transaction(async (tx) => {
    // Settled deliveries keep the channel's name, not the channel, so they do
    // not block. Only a delivery that still has a send to make needs the
    // config, and those drain in minutes, so this refusal is worth waiting
    // out rather than permanent.
    const [inFlight] = await tx
      .select({ count: countDistinct(alertDeliveries.dedupKey) })
      .from(alertDeliveries)
      .where(
        and(
          eq(alertDeliveries.organizationId, organizationId),
          eq(alertDeliveries.channelId, channel.id),
          deliveryIsInFlight,
        ),
      );
    if (inFlight && inFlight.count > 0) {
      throwAlertingPersistenceError(
        409,
        "conflict",
        `Channel has ${inFlight.count} notification${inFlight.count === 1 ? "" : "s"} still sending; retry once they settle`,
      );
    }
    // Release the settled rows before the delete. `channel_name` already
    // carries what a reader needs, so the trail keeps its meaning.
    await tx
      .update(alertDeliveries)
      .set({ channelId: null })
      .where(
        and(
          eq(alertDeliveries.organizationId, organizationId),
          eq(alertDeliveries.channelId, channel.id),
        ),
      );
    // Rules naming the channel directly do not veto the delete: they fall
    // back to the default destination once detached, and the as-code spec
    // still holds the name, so the next apply re-links a recreated channel
    // or warns on the missing one.
    await tx
      .delete(alertDefinitionChannels)
      .where(
        and(
          eq(alertDefinitionChannels.organizationId, organizationId),
          eq(alertDefinitionChannels.channelId, channel.id),
        ),
      );
    await tx.delete(alertChannels).where(eq(alertChannels.id, channel.id));
  });
  return { deleted: true };
}

export async function testChannel(
  _organizationId: string,
  body: { config: AlertingChannelConfig },
) {
  const started = performance.now();
  try {
    const { sendChannelTest } = await import("./channel-sender.server");
    await sendChannelTest(AlertingChannelConfigSchema.parse(body.config));
    return { ok: true, latency_ms: Math.round(performance.now() - started) };
  } catch (cause) {
    return {
      ok: false,
      latency_ms: Math.round(performance.now() - started),
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * The org's default destination: which channels each tier delivers to. The
 * "all" tier is the unsplit mode; per-severity tiers exist only when the org
 * split. Returned as name lists in stored order.
 */
export async function listDefaultDestination(organizationId: string) {
  const rows = await db
    .select({
      tier: alertDefaultChannels.tier,
      channelName: alertChannels.name,
      position: alertDefaultChannels.position,
    })
    .from(alertDefaultChannels)
    .innerJoin(
      alertChannels,
      and(
        eq(alertDefaultChannels.organizationId, alertChannels.organizationId),
        eq(alertDefaultChannels.channelId, alertChannels.id),
      ),
    )
    .where(eq(alertDefaultChannels.organizationId, organizationId))
    .orderBy(
      asc(alertDefaultChannels.tier),
      asc(alertDefaultChannels.position),
    );
  const tiers: Partial<Record<AlertingDefaultTier, string[]>> = {};
  for (const row of rows) {
    const list = tiers[row.tier] ?? [];
    list.push(row.channelName);
    tiers[row.tier] = list;
  }
  return { tiers };
}

/**
 * Replace the whole default destination in one write. Passing tiers with an
 * "all" entry stores unsplit mode; per-severity entries store split mode; the
 * two never coexist because this replaces everything. An empty object clears
 * the default entirely (alerts stop delivering unless a rule names channels).
 */
export async function setDefaultDestination(
  { organizationId }: AlertingMutationScope,
  rawInput: AlertingDefaultDestinationInput,
) {
  const input = AlertingDefaultDestinationInputSchema.parse(rawInput);
  const entries = Object.entries(input.tiers) as [
    AlertingDefaultTier,
    string[],
  ][];
  if (entries.some(([tier]) => tier === "all") && entries.length > 1) {
    throwAlertingPersistenceError(
      422,
      "validation",
      'the "all" tier cannot be combined with severity tiers',
    );
  }
  const names = [...new Set(entries.flatMap(([, channels]) => channels))];
  const resolved = await db
    .select({ id: alertChannels.id, name: alertChannels.name })
    .from(alertChannels)
    .where(
      and(
        eq(alertChannels.organizationId, organizationId),
        names.length > 0 ? inArray(alertChannels.name, names) : sql`false`,
      ),
    );
  const idByName = new Map(resolved.map((row) => [row.name, row.id]));
  const missing = names.filter((name) => !idByName.has(name));
  if (missing.length > 0) {
    throwAlertingPersistenceError(
      422,
      "validation",
      `Unknown channels: ${missing.join(", ")}`,
    );
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(alertDefaultChannels)
      .where(eq(alertDefaultChannels.organizationId, organizationId));
    const values = entries.flatMap(([tier, channels]) =>
      channels.map((name, position) => ({
        organizationId,
        tier,
        channelId: idByName.get(name) as string,
        position,
      })),
    );
    if (values.length > 0) {
      await tx.insert(alertDefaultChannels).values(values);
    }
  });
  return listDefaultDestination(organizationId);
}

/** Whether any default-destination tier has at least one channel. */
async function hasDefaultDestination(organizationId: string) {
  const [row] = await db
    .select({ tier: alertDefaultChannels.tier })
    .from(alertDefaultChannels)
    .where(eq(alertDefaultChannels.organizationId, organizationId))
    .limit(1);
  return Boolean(row);
}

async function resolveChannelIds(
  organizationId: string,
  names: string[],
  executor: DbExecutor = db,
): Promise<string[]> {
  const rows = await executor
    .select({ id: alertChannels.id, name: alertChannels.name })
    .from(alertChannels)
    .where(
      and(
        eq(alertChannels.organizationId, organizationId),
        inArray(alertChannels.name, names),
      ),
    );
  const byName = new Map(rows.map((row) => [row.name, row.id]));
  const missing = names.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throwAlertingPersistenceError(
      422,
      "validation",
      `Unknown channels: ${missing.join(", ")}`,
    );
  }
  return names.map((name) => byName.get(name) as string);
}

export async function resolveOptionalChannelIds(
  organizationId: string,
  names: string[],
  executor: DbExecutor = db,
): Promise<string[]> {
  return names.length === 0
    ? []
    : resolveChannelIds(organizationId, names, executor);
}
