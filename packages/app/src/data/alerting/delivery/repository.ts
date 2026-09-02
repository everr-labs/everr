import { randomUUID } from "node:crypto";
import { and, asc, countDistinct, eq, sql } from "drizzle-orm";
import { deliveryIsInFlight } from "@/data/alerting/delivery/config";
import { type DbExecutor, db } from "@/db/client";
import { alertChannels, alertDeliveries } from "@/db/schema";
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
} from "../schema";
import type { AlertingMutationScope } from "../session";
import type { AlertingChannelConfig } from "../types";
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
