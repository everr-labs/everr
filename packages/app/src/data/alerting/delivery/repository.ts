import { randomUUID } from "node:crypto";
import { and, asc, countDistinct, eq, inArray, sql } from "drizzle-orm";
import { deliveryIsInFlight } from "#app/data/alerting/delivery/config.ts";
import type { AlertingDefaultTier } from "#app/data/alerting/delivery/defaults.ts";
import { type DbExecutor, db } from "#app/db/client.ts";
import { alertChannels, alertDefaultChannels, alertDeliveries } from "#app/db/schema/index.ts";
import { truncateWithEllipsis } from "#app/lib/truncate.ts";
import { redactSecrets, sanitizeAlertError } from "#app/server/alerting/history/content.ts";
import {
  parseAlertingInput,
  throwAlertingPersistenceError,
  translateAlertingConflict,
} from "../persistence";
import {
  AlertingChannelInputSchema,
  AlertingChannelTestInputSchema,
  AlertingChannelUpdateSchema,
  AlertingDefaultDestinationInputSchema,
} from "../schema";
import type { AlertingMutationScope } from "../session";
import type {
  AlertingChannel,
  AlertingChannelConfig,
  AlertingChannelConfigInput,
  AlertingDefaultDestination,
} from "../types";
import {
  decryptChannelConfig,
  encryptChannelConfig,
  readRedactedChannelConfig,
} from "./channel-secrets.server";

function resolveWebhookHeaders(
  input: { name: string; value?: string }[] | undefined,
  previous: { name: string; value: string }[] | undefined,
  urlChanged: boolean,
): { name: string; value: string }[] | undefined {
  // Omitted means the edit did not speak about headers, so the saved list
  // stands. An empty list is the edit that clears them. A new URL does not
  // inherit either: the values are credentials for the previous endpoint.
  if (input === undefined) {
    if (urlChanged && (previous?.length ?? 0) > 0) {
      throwAlertingPersistenceError(
        422,
        "validation",
        "header values must be set again when the webhook URL changes",
      );
    }
    return urlChanged ? undefined : previous;
  }
  const stored = new Map(
    (urlChanged ? [] : (previous ?? [])).map((header) => [header.name.toLowerCase(), header.value]),
  );
  return input.map((header) => {
    const value = header.value ?? stored.get(header.name.toLowerCase());
    if (!value) {
      throwAlertingPersistenceError(
        422,
        "validation",
        `header value is required for ${header.name}`,
      );
    }
    return { name: header.name, value };
  });
}

/** Turn a write draft into a config that can actually send. Omission retains
 *  a secret only when the saved transport has the same type. */
function resolveChannelConfig(
  input: AlertingChannelConfigInput,
  previous: AlertingChannelConfig | null,
): AlertingChannelConfig {
  switch (input.type) {
    case "webhook": {
      const previousWebhook = previous?.type === "webhook" ? previous : undefined;
      const url = input.url ?? previousWebhook?.url;
      if (!url) {
        throwAlertingPersistenceError(422, "validation", "webhook URL is required");
      }
      // Stored header values stay with the endpoint they were saved for.
      const urlChanged = previousWebhook !== undefined && url !== previousWebhook.url;
      const headers = resolveWebhookHeaders(input.headers, previousWebhook?.headers, urlChanged);
      return {
        type: "webhook",
        url,
        ...(headers && headers.length > 0 ? { headers } : {}),
      };
    }
    case "slack":
    case "discord": {
      const url = input.url ?? (previous?.type === input.type ? previous.url : undefined);
      if (!url) {
        throwAlertingPersistenceError(422, "validation", `${input.type} URL is required`);
      }
      return { type: input.type, url };
    }
    case "telegram": {
      const botToken =
        input.bot_token ?? (previous?.type === "telegram" ? previous.bot_token : undefined);
      if (!botToken) {
        throwAlertingPersistenceError(422, "validation", "telegram bot token is required");
      }
      return {
        type: "telegram",
        bot_token: botToken,
        chat_ids: input.chat_ids,
      };
    }
  }
}

/** A channel as a screen reads it. The envelope carries the redacted copy,
 *  so listing every channel touches no key. */
function channelView(row: typeof alertChannels.$inferSelect): AlertingChannel {
  return {
    id: row.id,
    tenant: row.organizationId,
    name: row.name,
    config: readRedactedChannelConfig(row.encryptedConfig),
  };
}

export async function listChannels(organizationId: string, executor: DbExecutor = db) {
  const rows = await executor
    .select()
    .from(alertChannels)
    .where(eq(alertChannels.organizationId, organizationId))
    .orderBy(asc(alertChannels.name));
  return rows.map(channelView);
}

export async function createChannel({ organizationId }: AlertingMutationScope, rawInput: unknown) {
  const input = parseAlertingInput(AlertingChannelInputSchema, rawInput);
  const config = resolveChannelConfig(input.config, null);
  const id = randomUUID();
  const [row] = await translateAlertingConflict(() =>
    db
      .insert(alertChannels)
      .values({
        id,
        organizationId,
        name: input.name,
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
    .where(and(eq(alertChannels.organizationId, organizationId), eq(alertChannels.name, name)))
    .limit(1);
  if (!row) {
    throwAlertingPersistenceError(404, "not_found", `Channel not found: ${name}`);
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
    ? resolveChannelConfig(input.config, previousConfig)
    : previousConfig;
  const [row] = await translateAlertingConflict(() =>
    db
      .update(alertChannels)
      .set({
        name: input.name ?? name,
        encryptedConfig: encryptChannelConfig(organizationId, previous.id, nextConfig),
        updatedAt: new Date(),
      })
      .where(eq(alertChannels.id, previous.id))
      .returning(),
  );
  return channelView(row);
}

export async function deleteChannel({ organizationId }: AlertingMutationScope, name: string) {
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
function testChannelError(cause: unknown, secrets: readonly string[]): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return truncateWithEllipsis(
    sanitizeAlertError(redactSecrets(message, secrets)),
    TEST_CHANNEL_ERROR_MAX,
  );
}

function headerSecrets(config: AlertingChannelConfig | undefined): string[] {
  return config?.type === "webhook" ? (config.headers ?? []).map((header) => header.value) : [];
}

export async function testChannel(organizationId: string, body: unknown) {
  const started = performance.now();
  // Filled once the config resolves, so a send that throws can still scrub
  // header values out of the message. A rejection before that has nothing
  // to scrub, and the message is ours.
  let secrets: string[] = [];
  try {
    const { sendChannelTest } = await import("./channel-sender.server");
    const input = parseAlertingInput(AlertingChannelTestInputSchema, body);
    const stored =
      input.source.kind === "saved" ? await getChannelRow(organizationId, input.source.name) : null;
    const previous = stored
      ? decryptChannelConfig(organizationId, stored.id, stored.encryptedConfig)
      : null;
    const config = resolveChannelConfig(input.config, previous);
    secrets = headerSecrets(config);
    await sendChannelTest(config);
    return { ok: true, latency_ms: Math.round(performance.now() - started) };
  } catch (cause) {
    return {
      ok: false,
      latency_ms: Math.round(performance.now() - started),
      error: testChannelError(cause, secrets),
    };
  }
}

export async function listDefaultDestination(
  organizationId: string,
): Promise<AlertingDefaultDestination> {
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
  const tiers: AlertingDefaultDestination["tiers"] = {};
  for (const row of rows) {
    const list = tiers[row.tier] ?? [];
    list.push(row.channelName);
    tiers[row.tier] = list;
  }
  return { tiers };
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
  const input = parseAlertingInput(AlertingDefaultDestinationInputSchema, rawInput);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- Preserve input tier order; the input schema supplies the tier and channel types.
  const entries = Object.entries(input.tiers) as [AlertingDefaultTier, string[]][];
  if ("all" in input.tiers && entries.length > 1) {
    throwAlertingPersistenceError(
      422,
      "validation",
      'the "all" tier cannot be combined with severity tiers',
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
    throwAlertingPersistenceError(422, "validation", `Unknown channels: ${missing.join(", ")}`);
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(alertDefaultChannels)
      .where(eq(alertDefaultChannels.organizationId, organizationId));
    // Unique within a tier already: the schema refused duplicates.
    const values = entries.flatMap(([tier, channels]) =>
      channels.map((name) => ({
        organizationId,
        tier,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- Channel names were resolved above; retain the existing insert shape.
        channelId: idByName.get(name) as string,
      })),
    );
    if (values.length > 0) {
      await tx.insert(alertDefaultChannels).values(values);
    }
  });
  return listDefaultDestination(organizationId);
}
