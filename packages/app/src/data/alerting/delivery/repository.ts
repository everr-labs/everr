import { randomUUID } from "node:crypto";
import { and, asc, countDistinct, eq, inArray, sql } from "drizzle-orm";
import { deliveryIsInFlight } from "@/data/alerting/delivery/config";
import type { AlertingDefaultTier } from "@/data/alerting/routing/defaults";
import { type DbExecutor, db } from "@/db/client";
import {
  alertChannels,
  alertDefaultChannels,
  alertDeliveries,
} from "@/db/schema";
import { truncateWithEllipsis } from "@/lib/truncate";
import { sanitizeAlertError } from "@/server/alerting/history/content";
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
  // complete delivery setup. The existence check and the insert are one
  // statement, so the race window is a concurrent create's uncommitted row;
  // if two firsts both slip through, the default just holds both, which the
  // model allows.
  await db.execute(sql`
    INSERT INTO alert_default_channels (organization_id, tier, channel_id)
    SELECT ${organizationId}, 'all', ${id}
    WHERE NOT EXISTS (
      SELECT 1 FROM alert_default_channels
      WHERE organization_id = ${organizationId}
    )
    ON CONFLICT DO NOTHING
  `);
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
    // Rules naming the channel do not veto the delete: their specs keep the
    // name and delivery resolves names at flush, so the reference simply
    // stops matching until a channel with that name exists again.
    await tx.delete(alertChannels).where(eq(alertChannels.id, channel.id));
  });
  return { deleted: true };
}

const TEST_CHANNEL_ERROR_MAX = 300;

/**
 * What a failed channel test may say.
 *
 * The URL under test is whatever the member typed, so the send is a fetch the
 * server makes on their behalf: hand back the endpoint's response and the
 * test becomes a way to read any HTTP service the application plane can
 * reach. A ChannelSendError keeps that response in `responseBody` and out of
 * its message, so what is returned here is only ever text we wrote, and it is
 * still sanitized: a lower layer may have put a webhook URL or a bot token in
 * a message, and both are secrets.
 */
function testChannelError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return truncateWithEllipsis(
    sanitizeAlertError(message),
    TEST_CHANNEL_ERROR_MAX,
  );
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
      error: testChannelError(cause),
    };
  }
}

/**
 * The org's default destination: which channels each tier delivers to. The
 * "all" tier is the unsplit mode; per-severity tiers exist only when the org
 * split. Returned as name lists in name order.
 */
export async function listDefaultDestination(organizationId: string) {
  const rows = await db
    .select({
      tier: alertDefaultChannels.tier,
      channelName: alertChannels.name,
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
    .orderBy(asc(alertDefaultChannels.tier), asc(alertChannels.name));
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
      [...new Set(channels)].map((name) => ({
        organizationId,
        tier,
        channelId: idByName.get(name) as string,
      })),
    );
    if (values.length > 0) {
      await tx.insert(alertDefaultChannels).values(values);
    }
  });
  return listDefaultDestination(organizationId);
}
