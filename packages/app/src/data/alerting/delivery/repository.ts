import { randomUUID } from "node:crypto";
import { and, asc, countDistinct, eq, inArray, sql } from "drizzle-orm";
import { deliveryIsInFlight } from "@/data/alerting/delivery/config";
import {
  ALERTING_SEVERITY_TIERS,
  type AlertingDefaultTier,
} from "@/data/alerting/delivery/defaults";
import { type DbExecutor, db } from "@/db/client";
import {
  alertChannels,
  alertDefaultChannels,
  alertDefaultDestinations,
  alertDeliveries,
} from "@/db/schema";
import { truncateWithEllipsis } from "@/lib/truncate";
import { sanitizeAlertError } from "@/server/alerting/history/content";
import {
  parseAlertingInput,
  throwAlertingPersistenceError,
  translateAlertingConflict,
} from "../persistence";
import {
  AlertingChannelConfigSchema,
  AlertingChannelInputSchema,
  AlertingChannelUpdateSchema,
  AlertingDefaultDestinationInputSchema,
} from "../schema";
import type { AlertingMutationScope } from "../session";
import type {
  AlertingChannel,
  AlertingChannelConfig,
  AlertingDefaultDestination,
} from "../types";
import {
  decryptChannelConfig,
  encryptChannelConfig,
  readRedactedChannelConfig,
  retainRedactedChannelSecrets,
} from "./channel-secrets.server";

/** A channel as a screen reads it. The envelope carries the redacted copy,
 *  so listing every channel touches no key. */
function channelView(row: typeof alertChannels.$inferSelect): AlertingChannel {
  return {
    id: row.id,
    tenant: row.organizationId,
    name: row.name,
    config: readRedactedChannelConfig(
      row.organizationId,
      row.id,
      row.encryptedConfig,
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
  rawInput: unknown,
) {
  const input = parseAlertingInput(AlertingChannelInputSchema, rawInput);
  const id = randomUUID();
  const [row] = await translateAlertingConflict(() =>
    db
      .insert(alertChannels)
      .values({
        id,
        organizationId,
        name: input.name,
        encryptedConfig: encryptChannelConfig(organizationId, id, input.config),
      })
      .returning(),
  );
  // The first channel becomes the default destination, so one create is a
  // complete delivery setup. The existence check and the insert are one
  // statement, so the race window is a concurrent create's uncommitted row;
  // if two firsts both slip through, the default just holds both, which the
  // model allows.
  await db.transaction(async (tx) => {
    const inserted = await tx.execute<{ organization_id: string }>(sql`
      INSERT INTO alert_default_channels (organization_id, tier, channel_id)
      SELECT ${organizationId}, 'all', ${id}
      WHERE NOT EXISTS (
        SELECT 1 FROM alert_default_channels
        WHERE organization_id = ${organizationId}
      )
      ON CONFLICT DO NOTHING
      RETURNING organization_id
    `);
    if (inserted.rows.length > 0) {
      await tx
        .insert(alertDefaultDestinations)
        .values({ organizationId, split: false })
        .onConflictDoUpdate({
          target: alertDefaultDestinations.organizationId,
          set: { split: false },
        });
    }
  });
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
  rawInput: unknown,
) {
  const input = parseAlertingInput(AlertingChannelUpdateSchema, rawInput);
  const previous = await getChannelRow(organizationId, name);
  const previousConfig = decryptChannelConfig(
    organizationId,
    previous.id,
    previous.encryptedConfig,
  );
  const nextConfig = input.config
    ? retainRedactedChannelSecrets(input.config, previousConfig)
    : previousConfig;
  const [row] = await translateAlertingConflict(() =>
    db
      .update(alertChannels)
      .set({
        name: input.name ?? name,
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
  // One transaction. A flush that inserts a delivery for this channel between
  // the count and the delete would otherwise slip past the guard. It can still
  // land between the update and the delete. The foreign key then rejects the
  // delete and everything rolls back, which is the safe direction.
  await db.transaction(async (tx) => {
    // Settled deliveries keep the channel's name, not the channel, so they do
    // not block. Only a delivery with a send still to make needs the config,
    // and those drain in minutes. This refusal is worth waiting out.
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
 * server makes on their behalf. Handing back the endpoint's response would
 * turn the test into a way to read any HTTP service the application plane can
 * reach.
 *
 * A ChannelSendError keeps that response in `responseBody`, out of its
 * message, so what is returned here is only text we wrote. It is sanitized
 * anyway: a lower layer may have put a webhook URL or a bot token in a
 * message, and both are secrets.
 */
function testChannelError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return truncateWithEllipsis(
    sanitizeAlertError(message),
    TEST_CHANNEL_ERROR_MAX,
  );
}

export async function testChannel(
  organizationId: string,
  body: { name?: string; config: AlertingChannelConfig },
) {
  const started = performance.now();
  try {
    const { sendChannelTest } = await import("./channel-sender.server");
    const input = AlertingChannelConfigSchema.parse(body.config);
    let config = input;
    if (body.name) {
      const stored = await getChannelRow(organizationId, body.name);
      config = retainRedactedChannelSecrets(
        input,
        decryptChannelConfig(organizationId, stored.id, stored.encryptedConfig),
      );
    }
    await sendChannelTest(config);
    return { ok: true, latency_ms: Math.round(performance.now() - started) };
  } catch (cause) {
    return {
      ok: false,
      latency_ms: Math.round(performance.now() - started),
      error: testChannelError(cause),
    };
  }
}

export async function listDefaultDestination(
  organizationId: string,
): Promise<AlertingDefaultDestination> {
  const [rows, [settings]] = await Promise.all([
    db
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
      .orderBy(asc(alertDefaultChannels.tier), asc(alertChannels.name)),
    db
      .select({ split: alertDefaultDestinations.split })
      .from(alertDefaultDestinations)
      .where(eq(alertDefaultDestinations.organizationId, organizationId))
      .limit(1),
  ]);
  const tiers: AlertingDefaultDestination["tiers"] = {};
  for (const row of rows) {
    const list = tiers[row.tier] ?? [];
    list.push(row.channelName);
    tiers[row.tier] = list;
  }
  return {
    split: settings?.split ?? rows.some((row) => row.tier !== ("all" as const)),
    tiers,
  };
}

/**
 * Replace the default destination wholesale. The two modes are exclusive:
 * "all" alone, or any of the severity tiers. Every named channel has to
 * exist, because a default row is a foreign key to the channel and a name
 * nobody has would otherwise fail deep in the insert with a message about
 * ids.
 */
export async function setDefaultDestination(
  { organizationId }: AlertingMutationScope,
  rawInput: unknown,
): Promise<AlertingDefaultDestination> {
  const input = parseAlertingInput(
    AlertingDefaultDestinationInputSchema,
    rawInput,
  );
  const entries = Object.entries(input.tiers) as [
    AlertingDefaultTier,
    string[],
  ][];
  const split =
    input.split ?? ALERTING_SEVERITY_TIERS.some((tier) => tier in input.tiers);
  if ("all" in input.tiers && entries.length > 1) {
    throwAlertingPersistenceError(
      422,
      "validation",
      'the "all" tier cannot be combined with severity tiers',
    );
  }
  if (split && "all" in input.tiers) {
    throwAlertingPersistenceError(
      422,
      "validation",
      'the "all" tier cannot be used while delivery is split',
    );
  }
  if (!split && entries.length > 0 && !("all" in input.tiers)) {
    throwAlertingPersistenceError(
      422,
      "validation",
      "severity tiers require split delivery",
    );
  }
  const names = [...new Set(entries.flatMap(([, channels]) => channels))];
  const resolved =
    names.length === 0
      ? []
      : await db
          .select({ id: alertChannels.id, name: alertChannels.name })
          .from(alertChannels)
          .where(
            and(
              eq(alertChannels.organizationId, organizationId),
              inArray(alertChannels.name, names),
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
      .insert(alertDefaultDestinations)
      .values({ organizationId, split })
      .onConflictDoUpdate({
        target: alertDefaultDestinations.organizationId,
        set: { split },
      });
    await tx
      .delete(alertDefaultChannels)
      .where(eq(alertDefaultChannels.organizationId, organizationId));
    // Unique within a tier already: the schema refused duplicates.
    const values = entries.flatMap(([tier, channels]) =>
      channels.map((name) => ({
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
