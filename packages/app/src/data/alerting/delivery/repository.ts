import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { type DbExecutor, db } from "@/db/client";
import {
  alertChannels,
  alertDefinitionChannels,
  alertDefinitions,
  alertDeliveries,
  alertInhibitions,
  alertReceiverChannels,
  alertReceivers,
  alertRoutes,
} from "@/db/schema";
import {
  throwAlertingPersistenceError,
  translateAlertingConflict,
} from "../persistence";
import {
  AlertingChannelConfigSchema,
  AlertingInhibitionInputSchema,
  AlertingRouteInputSchema,
} from "../schema";
import type {
  AlertingChannelConfig,
  AlertingInhibitionInput,
  AlertingRouteInput,
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

export async function listChannels(organizationId: string) {
  const rows = await db
    .select()
    .from(alertChannels)
    .where(eq(alertChannels.organizationId, organizationId))
    .orderBy(asc(alertChannels.name));
  return rows.map(channelView);
}

export async function createChannel(
  organizationId: string,
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
  organizationId: string,
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

export async function deleteChannel(organizationId: string, name: string) {
  const channel = await getChannelRow(organizationId, name);
  const [receiverRefs, definitionRefs] = await Promise.all([
    db
      .select({ receiver: alertReceivers.name })
      .from(alertReceiverChannels)
      .innerJoin(
        alertReceivers,
        eq(alertReceiverChannels.receiverId, alertReceivers.id),
      )
      .where(eq(alertReceiverChannels.channelId, channel.id)),
    db
      .select({
        project: alertDefinitions.project,
        slug: alertDefinitions.slug,
      })
      .from(alertDefinitionChannels)
      .innerJoin(
        alertDefinitions,
        eq(alertDefinitionChannels.alertDefinitionId, alertDefinitions.id),
      )
      .where(eq(alertDefinitionChannels.channelId, channel.id)),
  ]);
  if (receiverRefs.length > 0) {
    throwAlertingPersistenceError(
      409,
      "conflict",
      `Channel is used by receivers: ${receiverRefs.map((r) => r.receiver).join(", ")}`,
    );
  }
  if (definitionRefs.length > 0) {
    throwAlertingPersistenceError(
      409,
      "conflict",
      `Channel is used directly by alerts: ${definitionRefs.map((r) => `${r.project}/${r.slug}`).join(", ")}`,
    );
  }
  const [delivery] = await db
    .select({ dedupKey: alertDeliveries.dedupKey })
    .from(alertDeliveries)
    .where(
      and(
        eq(alertDeliveries.organizationId, organizationId),
        eq(alertDeliveries.channelId, channel.id),
      ),
    )
    .limit(1);
  if (delivery) {
    throwAlertingPersistenceError(
      409,
      "conflict",
      "Channel is referenced by notification history",
    );
  }
  await db.delete(alertChannels).where(eq(alertChannels.id, channel.id));
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

async function receiverChannels(organizationId: string) {
  const links = await db
    .select({
      receiverId: alertReceiverChannels.receiverId,
      channelName: alertChannels.name,
      position: alertReceiverChannels.position,
    })
    .from(alertReceiverChannels)
    .innerJoin(
      alertChannels,
      eq(alertReceiverChannels.channelId, alertChannels.id),
    )
    .where(eq(alertReceiverChannels.organizationId, organizationId))
    .orderBy(asc(alertReceiverChannels.position));
  const byReceiver = new Map<string, string[]>();
  for (const link of links) {
    const names = byReceiver.get(link.receiverId) ?? [];
    names.push(link.channelName);
    byReceiver.set(link.receiverId, names);
  }
  return byReceiver;
}

export async function listReceivers(organizationId: string) {
  const [rows, channels] = await Promise.all([
    db
      .select()
      .from(alertReceivers)
      .where(eq(alertReceivers.organizationId, organizationId))
      .orderBy(asc(alertReceivers.name)),
    receiverChannels(organizationId),
  ]);
  return rows.map((row) => ({
    id: row.id,
    tenant: row.organizationId,
    name: row.name,
    channels: channels.get(row.id) ?? [],
  }));
}

async function resolveChannelIds(
  organizationId: string,
  names: string[],
  executor: DbExecutor = db,
): Promise<string[]> {
  if (names.length === 0) {
    throwAlertingPersistenceError(
      422,
      "validation",
      "receiver needs a channel",
    );
  }
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

export async function createReceiver(
  organizationId: string,
  body: { name: string; channels: string[] },
) {
  const channelIds = await resolveChannelIds(organizationId, body.channels);
  return translateAlertingConflict(() =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(alertReceivers)
        .values({ organizationId, name: body.name })
        .returning();
      await tx.insert(alertReceiverChannels).values(
        channelIds.map((channelId, position) => ({
          organizationId,
          receiverId: row.id,
          channelId,
          position,
        })),
      );
      return {
        id: row.id,
        tenant: organizationId,
        name: row.name,
        channels: body.channels,
      };
    }),
  );
}

async function getReceiverRow(organizationId: string, name: string) {
  const [row] = await db
    .select()
    .from(alertReceivers)
    .where(
      and(
        eq(alertReceivers.organizationId, organizationId),
        eq(alertReceivers.name, name),
      ),
    )
    .limit(1);
  if (!row) {
    throwAlertingPersistenceError(
      404,
      "not_found",
      `Receiver not found: ${name}`,
    );
  }
  return row;
}

export async function updateReceiver(
  organizationId: string,
  name: string,
  body: { name?: string; channels: string[] },
) {
  const previous = await getReceiverRow(organizationId, name);
  const channelIds = await resolveChannelIds(organizationId, body.channels);
  return translateAlertingConflict(() =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .update(alertReceivers)
        .set({ name: body.name ?? name, updatedAt: new Date() })
        .where(eq(alertReceivers.id, previous.id))
        .returning();
      await tx
        .delete(alertReceiverChannels)
        .where(eq(alertReceiverChannels.receiverId, previous.id));
      await tx.insert(alertReceiverChannels).values(
        channelIds.map((channelId, position) => ({
          organizationId,
          receiverId: previous.id,
          channelId,
          position,
        })),
      );
      return {
        id: row.id,
        tenant: organizationId,
        name: row.name,
        channels: body.channels,
      };
    }),
  );
}

export async function deleteReceiver(organizationId: string, name: string) {
  const receiver = await getReceiverRow(organizationId, name);
  const routes = await db
    .select({ id: alertRoutes.id })
    .from(alertRoutes)
    .where(eq(alertRoutes.receiverId, receiver.id));
  if (routes.length > 0) {
    throwAlertingPersistenceError(
      409,
      "conflict",
      `Receiver is used by ${routes.length} route(s)`,
    );
  }
  await db.delete(alertReceivers).where(eq(alertReceivers.id, receiver.id));
  return { deleted: true };
}

export async function listRoutes(organizationId: string) {
  const rows = await db
    .select({ route: alertRoutes, receiver: alertReceivers.name })
    .from(alertRoutes)
    .innerJoin(alertReceivers, eq(alertRoutes.receiverId, alertReceivers.id))
    .where(eq(alertRoutes.organizationId, organizationId))
    .orderBy(asc(alertRoutes.priority));
  return rows.map(({ route, receiver }) => ({
    id: route.id,
    tenant: organizationId,
    receiver,
    priority: route.priority,
    ...route.config,
  }));
}

export async function createRoute(
  organizationId: string,
  rawInput: AlertingRouteInput,
) {
  const input = AlertingRouteInputSchema.parse(rawInput);
  const receiver = await getReceiverRow(organizationId, input.receiver);
  const { receiver: _receiver, priority, ...config } = input;
  const [row] = await db
    .insert(alertRoutes)
    .values({ organizationId, receiverId: receiver.id, priority, config })
    .returning();
  return {
    id: row.id,
    tenant: organizationId,
    receiver: receiver.name,
    priority,
    ...config,
  };
}

export async function updateRoute(
  organizationId: string,
  id: string,
  rawInput: AlertingRouteInput,
) {
  const input = AlertingRouteInputSchema.parse(rawInput);
  const receiver = await getReceiverRow(organizationId, input.receiver);
  const { receiver: _receiver, priority, ...config } = input;
  const [row] = await db
    .update(alertRoutes)
    .set({ receiverId: receiver.id, priority, config, updatedAt: new Date() })
    .where(
      and(
        eq(alertRoutes.organizationId, organizationId),
        eq(alertRoutes.id, id),
      ),
    )
    .returning();
  if (!row) {
    throwAlertingPersistenceError(404, "not_found", `Route not found: ${id}`);
  }
  return {
    id: row.id,
    tenant: organizationId,
    receiver: receiver.name,
    priority,
    ...config,
  };
}

export async function deleteRoute(organizationId: string, id: string) {
  const rows = await db
    .delete(alertRoutes)
    .where(
      and(
        eq(alertRoutes.organizationId, organizationId),
        eq(alertRoutes.id, id),
      ),
    )
    .returning({ id: alertRoutes.id });
  return { deleted: rows.length > 0 };
}

export async function listInhibitions(organizationId: string) {
  const rows = await db
    .select()
    .from(alertInhibitions)
    .where(eq(alertInhibitions.organizationId, organizationId))
    .orderBy(desc(alertInhibitions.createdAt));
  return rows.map((row) => ({
    id: row.id,
    tenant: row.organizationId,
    ...row.config,
    created_at: row.createdAt.toISOString(),
  }));
}

export async function createInhibition(
  organizationId: string,
  rawInput: AlertingInhibitionInput,
) {
  const config = AlertingInhibitionInputSchema.parse(rawInput);
  const [row] = await db
    .insert(alertInhibitions)
    .values({ organizationId, config })
    .returning();
  return {
    id: row.id,
    tenant: row.organizationId,
    ...config,
    created_at: row.createdAt.toISOString(),
  };
}

export async function deleteInhibition(organizationId: string, id: string) {
  const rows = await db
    .delete(alertInhibitions)
    .where(
      and(
        eq(alertInhibitions.organizationId, organizationId),
        eq(alertInhibitions.id, id),
      ),
    )
    .returning({ id: alertInhibitions.id });
  return { deleted: rows.length > 0 };
}
