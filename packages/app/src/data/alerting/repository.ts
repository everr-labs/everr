import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { parseResourceName } from "@/data/as-code/identity";
import { parseSloWindowSeconds } from "@/data/slos/schema";
import { db, type Transaction } from "@/db/client";
import {
  alertChannels,
  alertDefinitionChannels,
  alertDefinitions,
  alertDeliveries,
  alertEvaluations,
  alertInhibitions,
  alertInstances,
  alertReceiverChannels,
  alertReceivers,
  alertRoutes,
  alertSilences,
  sloAlertInstances,
  sloDefinitions,
} from "@/db/schema";
import { querySqlApi } from "@/lib/clickhouse";
import {
  enqueueAlertEvaluation,
  enqueueSloEvaluation,
} from "@/server/alerts/01-scanner";
import {
  decryptChannelConfig,
  encryptChannelConfig,
  redactChannelConfig,
  retainRedactedChannelSecrets,
} from "@/server/alerts/channel-secrets";
import { AlertingError } from "./errors";
import { shapeAlertEvaluationSeries } from "./evaluation-series";
import {
  AlertingChannelConfigSchema,
  AlertingInhibitionInputSchema,
  AlertingRouteInputSchema,
  AlertingRuleInputSchema,
  AlertingRuleSpecSchema,
  AlertingRuleUpdateSchema,
  AlertingSilenceInputSchema,
  AlertingSloInputSchema,
  AlertingSloSpecSchema,
  AlertingSloUpdateSchema,
} from "./schema";
import {
  ALERTING_SLO_INGEST_DELAY_SECS,
  alertingFormatClickHouseDateTime,
} from "./slo";
import type {
  AlertingChannelConfig,
  AlertingInhibitionInput,
  AlertingRouteInput,
  AlertingRuleInput,
  AlertingRuleUpdate,
  AlertingSilenceInput,
  AlertingSloInput,
  AlertingSloSpec,
  AlertingSloUpdate,
} from "./types";

type RuleRow = typeof alertDefinitions.$inferSelect;
type SloRow = typeof sloDefinitions.$inferSelect;

function error(status: number, code: string, message: string): never {
  throw new AlertingError(status, code, message);
}

function postgresCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { code?: unknown; cause?: unknown };
  if (typeof record.code === "string") return record.code;
  return postgresCode(record.cause);
}

async function translateConflict<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (postgresCode(cause) === "23505" || postgresCode(cause) === "23503") {
      error(409, "conflict", "alerting resource conflicts with existing state");
    }
    throw cause;
  }
}

function ruleName(row: RuleRow): string {
  return `${row.project}/${row.slug}`;
}

function ruleBase(row: RuleRow, notificationChannels: string[]) {
  return {
    id: row.id,
    tenant: row.organizationId,
    repoid: row.repoid,
    previewId: row.previewId,
    name: ruleName(row),
    notification_channels: notificationChannels,
    spec: row.spec,
    version: row.version,
    paused: !row.active,
  };
}

function ruleView(row: RuleRow, notificationChannels: string[]) {
  return {
    ...ruleBase(row, notificationChannels),
    updated_at: row.updatedAt.toISOString(),
    health: {
      status: row.healthStatus,
      consecutive_failures: row.consecutiveFailures,
      degraded_since: row.degradedSince?.toISOString() ?? null,
      last_error: row.lastError,
      last_error_at: row.lastErrorAt?.toISOString() ?? null,
    },
    rollup: {
      alert_state:
        row.currentState === "firing"
          ? ("firing" as const)
          : ("inactive" as const),
      firing_instance_count: row.firingInstanceCount,
      last_fired_at: row.lastFiredAt?.toISOString() ?? null,
      last_resolved_at: row.lastResolvedAt?.toISOString() ?? null,
      last_seen_at: row.lastSeenAt?.toISOString() ?? null,
      next_evaluation_at: row.nextEvaluationAt?.toISOString() ?? null,
      last_row_count: row.lastRowCount,
    },
  };
}

async function definitionChannelNames(
  organizationId: string,
  definitionIds: string[],
): Promise<Map<string, string[]>> {
  if (definitionIds.length === 0) return new Map();
  const rows = await db
    .select({
      alertDefinitionId: alertDefinitionChannels.alertDefinitionId,
      channelName: alertChannels.name,
      position: alertDefinitionChannels.position,
    })
    .from(alertDefinitionChannels)
    .innerJoin(
      alertChannels,
      and(
        eq(
          alertDefinitionChannels.organizationId,
          alertChannels.organizationId,
        ),
        eq(alertDefinitionChannels.channelId, alertChannels.id),
      ),
    )
    .where(
      and(
        eq(alertDefinitionChannels.organizationId, organizationId),
        inArray(alertDefinitionChannels.alertDefinitionId, definitionIds),
      ),
    )
    .orderBy(
      asc(alertDefinitionChannels.alertDefinitionId),
      asc(alertDefinitionChannels.position),
    );
  const namesByDefinition = new Map<string, string[]>();
  for (const row of rows) {
    const names = namesByDefinition.get(row.alertDefinitionId) ?? [];
    names.push(row.channelName);
    namesByDefinition.set(row.alertDefinitionId, names);
  }
  return namesByDefinition;
}

async function definitionChannelNamesFor(
  organizationId: string,
  definitionId: string,
): Promise<string[]> {
  return (
    (await definitionChannelNames(organizationId, [definitionId])).get(
      definitionId,
    ) ?? []
  );
}

async function replaceDefinitionChannels(
  tx: Transaction,
  organizationId: string,
  alertDefinitionId: string,
  channelIds: string[],
) {
  await tx
    .delete(alertDefinitionChannels)
    .where(eq(alertDefinitionChannels.alertDefinitionId, alertDefinitionId));
  if (channelIds.length === 0) return;
  await tx.insert(alertDefinitionChannels).values(
    channelIds.map((channelId, position) => ({
      organizationId,
      alertDefinitionId,
      channelId,
      position,
    })),
  );
}

function encodeOffset(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const value = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!Number.isSafeInteger(value) || value < 0) {
    error(422, "validation", "invalid pagination cursor");
  }
  return value;
}

export async function listRulesPage(
  organizationId: string,
  opts: {
    limit?: number;
    cursor?: string;
    previewId?: string | null;
    name?: string;
  } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = decodeOffset(opts.cursor);
  const filters = [eq(alertDefinitions.organizationId, organizationId)];
  if (opts.previewId !== undefined) {
    filters.push(
      opts.previewId === null
        ? isNull(alertDefinitions.previewId)
        : eq(alertDefinitions.previewId, opts.previewId),
    );
  }
  if (opts.name !== undefined) {
    const { project, slug } = parseResourceName(opts.name);
    filters.push(eq(alertDefinitions.project, project));
    filters.push(eq(alertDefinitions.slug, slug));
  }
  const rows = await db
    .select()
    .from(alertDefinitions)
    .where(and(...filters))
    .orderBy(desc(alertDefinitions.updatedAt), desc(alertDefinitions.id))
    .limit(limit + 1)
    .offset(offset);
  const pageRows = rows.slice(0, limit);
  const channels = await definitionChannelNames(
    organizationId,
    pageRows.map((row) => row.id),
  );
  return {
    items: pageRows.map((row) => ruleView(row, channels.get(row.id) ?? [])),
    next_cursor: rows.length > limit ? encodeOffset(offset + limit) : null,
  };
}

export async function listAllRules(
  organizationId: string,
  opts: { previewId?: string | null; name?: string } = {},
) {
  const all: ReturnType<typeof ruleView>[] = [];
  let cursor: string | undefined;
  do {
    const page = await listRulesPage(organizationId, {
      ...opts,
      limit: 500,
      ...(cursor ? { cursor } : {}),
    });
    all.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return all;
}

async function getRuleRow(
  organizationId: string,
  id: string,
): Promise<RuleRow> {
  const [row] = await db
    .select()
    .from(alertDefinitions)
    .where(
      and(
        eq(alertDefinitions.organizationId, organizationId),
        eq(alertDefinitions.id, id),
      ),
    )
    .limit(1);
  if (!row) error(404, "not_found", `Rule not found: ${id}`);
  return row;
}

export async function getRule(organizationId: string, id: string) {
  const row = await getRuleRow(organizationId, id);
  return ruleView(row, await definitionChannelNamesFor(organizationId, row.id));
}

export async function getRuleEvaluationSeries(
  organizationId: string,
  id: string,
  opts: { from: Date; to: Date; points: number },
) {
  // The evaluation table is keyed by the globally unique definition id; this
  // lookup is the tenant authorization boundary before reading its history.
  await getRuleRow(organizationId, id);
  const rows = await db
    .select({
      scheduledFor: alertEvaluations.scheduledFor,
      error: alertEvaluations.error,
      rowCount: alertEvaluations.rowCount,
      samples: alertEvaluations.samples,
      samplesTruncated: alertEvaluations.samplesTruncated,
    })
    .from(alertEvaluations)
    .where(
      and(
        eq(alertEvaluations.alertDefinitionId, id),
        gte(alertEvaluations.scheduledFor, opts.from),
        lte(alertEvaluations.scheduledFor, opts.to),
      ),
    )
    .orderBy(asc(alertEvaluations.scheduledFor));
  return shapeAlertEvaluationSeries(rows, opts.points);
}

function definitionValues(organizationId: string, input: AlertingRuleInput) {
  const { project, slug } = parseResourceName(input.name);
  const spec = AlertingRuleSpecSchema.parse(input);
  return {
    organizationId,
    repoid: input.repoid,
    previewId: input.previewId,
    project,
    slug,
    spec,
    nextEvaluationAt: new Date(),
    active: true,
  };
}

export async function createRule(
  organizationId: string,
  rawInput: AlertingRuleInput,
) {
  const input = AlertingRuleInputSchema.parse(rawInput);
  const channelIds = await resolveOptionalChannelIds(
    organizationId,
    input.notification_channels,
  );
  const row = await translateConflict(() =>
    db.transaction(async (tx) => {
      const [created] = await tx
        .insert(alertDefinitions)
        .values(definitionValues(organizationId, input))
        .returning();
      await replaceDefinitionChannels(
        tx,
        organizationId,
        created.id,
        channelIds,
      );
      return created;
    }),
  );
  await enqueueAlertEvaluation({
    alertDefinitionId: row.id,
    scheduledFor:
      row.nextEvaluationAt?.toISOString() ?? new Date().toISOString(),
    ruleVersion: row.version,
  });
  return ruleBase(row, input.notification_channels);
}

export async function updateRule(
  organizationId: string,
  id: string,
  rawSpec: AlertingRuleUpdate,
  version?: number,
) {
  const input = AlertingRuleUpdateSchema.parse(rawSpec);
  const { notification_channels: notificationChannels, ...rawRuleSpec } = input;
  const spec = AlertingRuleSpecSchema.parse(rawRuleSpec);
  const channelIds = await resolveOptionalChannelIds(
    organizationId,
    notificationChannels,
  );
  const previous = await getRuleRow(organizationId, id);
  if (version !== undefined && previous.version !== version) {
    error(409, "conflict", `Rule version changed: ${id}`);
  }
  const labelsChanged =
    JSON.stringify(previous.spec.label_columns) !==
    JSON.stringify(spec.label_columns);
  const updated = await translateConflict(() =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .update(alertDefinitions)
        .set({
          spec,
          version: previous.version + 1,
          nextEvaluationAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(alertDefinitions.organizationId, organizationId),
            eq(alertDefinitions.id, id),
            eq(alertDefinitions.version, previous.version),
          ),
        )
        .returning();
      if (!row) error(409, "conflict", `Rule version changed: ${id}`);
      if (labelsChanged) {
        await tx
          .delete(alertInstances)
          .where(eq(alertInstances.alertDefinitionId, id));
      }
      await replaceDefinitionChannels(tx, organizationId, id, channelIds);
      return row;
    }),
  );
  await enqueueAlertEvaluation({
    alertDefinitionId: updated.id,
    scheduledFor:
      updated.nextEvaluationAt?.toISOString() ?? new Date().toISOString(),
    ruleVersion: updated.version,
  });
  return ruleBase(updated, notificationChannels);
}

export async function adoptRule(
  organizationId: string,
  id: string,
  repoid: string,
  version: number,
  rawSpec?: AlertingRuleUpdate,
) {
  if (repoid.length === 0) error(422, "validation", "repoid is required");
  const previous = await getRuleRow(organizationId, id);
  if (previous.version !== version || previous.previewId !== null) {
    error(409, "conflict", `Rule version changed: ${id}`);
  }
  const input = rawSpec ? AlertingRuleUpdateSchema.parse(rawSpec) : null;
  const notificationChannels = input?.notification_channels;
  const spec = input
    ? AlertingRuleSpecSchema.parse(
        Object.fromEntries(
          Object.entries(input).filter(
            ([key]) => key !== "notification_channels",
          ),
        ),
      )
    : null;
  const channelIds = notificationChannels
    ? await resolveOptionalChannelIds(organizationId, notificationChannels)
    : null;
  const labelsChanged =
    spec !== null &&
    JSON.stringify(previous.spec.label_columns) !==
      JSON.stringify(spec.label_columns);
  const row = await translateConflict(() =>
    db.transaction(async (tx) => {
      const [updated] = await tx
        .update(alertDefinitions)
        .set({
          repoid,
          ...(spec ? { spec, nextEvaluationAt: new Date() } : {}),
          version: version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(alertDefinitions.organizationId, organizationId),
            eq(alertDefinitions.id, id),
            eq(alertDefinitions.version, version),
            isNull(alertDefinitions.previewId),
          ),
        )
        .returning();
      if (!updated) error(409, "conflict", `Rule version changed: ${id}`);
      if (labelsChanged) {
        await tx
          .delete(alertInstances)
          .where(eq(alertInstances.alertDefinitionId, id));
      }
      if (channelIds) {
        await replaceDefinitionChannels(tx, organizationId, id, channelIds);
      }
      return updated;
    }),
  );
  if (!row) error(409, "conflict", `Rule version changed: ${id}`);
  if (spec) {
    await enqueueAlertEvaluation({
      alertDefinitionId: row.id,
      scheduledFor:
        row.nextEvaluationAt?.toISOString() ?? new Date().toISOString(),
      ruleVersion: row.version,
    });
  }
  return ruleBase(
    row,
    notificationChannels ??
      (await definitionChannelNamesFor(organizationId, row.id)),
  );
}

export async function deleteRule(organizationId: string, id: string) {
  const rows = await db
    .delete(alertDefinitions)
    .where(
      and(
        eq(alertDefinitions.organizationId, organizationId),
        eq(alertDefinitions.id, id),
      ),
    )
    .returning({ id: alertDefinitions.id });
  return { deleted: rows.length > 0 };
}

export async function pauseRule(organizationId: string, id: string) {
  const [row] = await db
    .update(alertDefinitions)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(alertDefinitions.organizationId, organizationId),
        eq(alertDefinitions.id, id),
      ),
    )
    .returning();
  if (!row) error(404, "not_found", `Rule not found: ${id}`);
  return ruleBase(row, await definitionChannelNamesFor(organizationId, row.id));
}

export async function resumeRule(organizationId: string, id: string) {
  const [row] = await db
    .update(alertDefinitions)
    .set({ active: true, nextEvaluationAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(alertDefinitions.organizationId, organizationId),
        eq(alertDefinitions.id, id),
      ),
    )
    .returning();
  if (!row) error(404, "not_found", `Rule not found: ${id}`);
  await enqueueAlertEvaluation({
    alertDefinitionId: row.id,
    scheduledFor:
      row.nextEvaluationAt?.toISOString() ?? new Date().toISOString(),
    ruleVersion: row.version,
  });
  return ruleBase(row, await definitionChannelNamesFor(organizationId, row.id));
}

export async function listAlerts(organizationId: string) {
  const [rows, sloRows] = await Promise.all([
    db
      .select()
      .from(alertInstances)
      .where(eq(alertInstances.organizationId, organizationId))
      .orderBy(desc(alertInstances.updatedAt)),
    db
      .select()
      .from(sloAlertInstances)
      .where(eq(sloAlertInstances.organizationId, organizationId))
      .orderBy(desc(sloAlertInstances.updatedAt)),
  ]);
  return [
    ...rows.map((row) => ({
      key: `${row.alertDefinitionId}:${row.fingerprint}`,
      fingerprint: row.fingerprint,
      rule: row.alertDefinitionId,
      slo: undefined as string | undefined,
      tenant: row.organizationId,
      status: row.status,
      labels: row.labels,
      value: row.value,
      pending_since: row.pendingSince?.toISOString() ?? null,
      active_since: row.activeSince?.toISOString() ?? null,
      last_seen: row.lastSeenAt?.toISOString() ?? null,
      absent_count: row.absentCount,
    })),
    ...sloRows.map((row) => ({
      key: `${row.sloDefinitionId}:${row.tier}`,
      fingerprint: row.tier,
      rule: row.sloDefinitionId,
      slo: row.sloDefinitionId as string | undefined,
      tenant: row.organizationId,
      status: row.status,
      labels: row.labels,
      value: row.value,
      pending_since: null,
      active_since: row.activeSince?.toISOString() ?? null,
      last_seen: row.lastSeenAt?.toISOString() ?? null,
      absent_count: 0,
    })),
  ].sort(
    (a, b) =>
      new Date(b.last_seen ?? 0).getTime() -
      new Date(a.last_seen ?? 0).getTime(),
  );
}

function sloBase(row: SloRow) {
  return {
    id: row.id,
    tenant: row.organizationId,
    repoid: row.repoid,
    previewId: row.previewId,
    name: `${row.project}/${row.slug}`,
    spec: row.spec,
    version: row.version,
    paused: row.paused,
  };
}

function sloView(row: SloRow) {
  return {
    ...sloBase(row),
    updated_at: row.updatedAt.toISOString(),
    budget_epoch: row.budgetEpoch.toISOString(),
  };
}

export async function listSlos(
  organizationId: string,
  opts: { previewId?: string | null; name?: string } = {},
) {
  const filters = [eq(sloDefinitions.organizationId, organizationId)];
  if (opts.previewId !== undefined) {
    filters.push(
      opts.previewId === null
        ? isNull(sloDefinitions.previewId)
        : eq(sloDefinitions.previewId, opts.previewId),
    );
  }
  if (opts.name !== undefined) {
    const { project, slug } = parseResourceName(opts.name);
    filters.push(eq(sloDefinitions.project, project));
    filters.push(eq(sloDefinitions.slug, slug));
  }
  const rows = await db
    .select()
    .from(sloDefinitions)
    .where(and(...filters))
    .orderBy(desc(sloDefinitions.updatedAt));
  return rows.map(sloView);
}

async function getSloRow(organizationId: string, id: string): Promise<SloRow> {
  const [row] = await db
    .select()
    .from(sloDefinitions)
    .where(
      and(
        eq(sloDefinitions.organizationId, organizationId),
        eq(sloDefinitions.id, id),
      ),
    )
    .limit(1);
  if (!row) error(404, "not_found", `SLO not found: ${id}`);
  return row;
}

export async function getSlo(organizationId: string, id: string) {
  return sloView(await getSloRow(organizationId, id));
}

export async function getSloStatus(organizationId: string, id: string) {
  const row = await getSloRow(organizationId, id);
  return {
    computed_at: row.statusComputedAt?.toISOString() ?? null,
    payload: row.status,
    health: {
      status: row.healthStatus,
      degraded_since: row.degradedSince?.toISOString() ?? null,
      last_error: row.lastError,
    },
  };
}

export async function createSlo(
  organizationId: string,
  rawInput: AlertingSloInput,
) {
  const input = AlertingSloInputSchema.parse(rawInput);
  const { name, repoid, previewId, ...rawSpec } = input;
  const { project, slug } = parseResourceName(name);
  const spec = AlertingSloSpecSchema.parse(rawSpec);
  const [row] = await translateConflict(() =>
    db
      .insert(sloDefinitions)
      .values({
        organizationId,
        repoid,
        previewId,
        project,
        slug,
        spec,
        nextEvaluationAt: new Date(),
      })
      .returning(),
  );
  await enqueueSloEvaluation({
    sloDefinitionId: row.id,
    scheduledFor: row.nextEvaluationAt.toISOString(),
    sloVersion: row.version,
  });
  return sloBase(row);
}

export async function adoptSlo(
  organizationId: string,
  id: string,
  repoid: string,
  version: number,
  rawSpec?: AlertingSloUpdate,
) {
  if (repoid.length === 0) error(422, "validation", "repoid is required");
  const previous = await getSloRow(organizationId, id);
  if (previous.version !== version || previous.previewId !== null) {
    error(409, "conflict", `SLO version changed: ${id}`);
  }
  const spec = rawSpec ? AlertingSloUpdateSchema.parse(rawSpec) : null;
  const budgetChanged =
    spec !== null &&
    (previous.spec.sli.sql !== spec.sli.sql ||
      previous.spec.targetPercent !== spec.targetPercent ||
      JSON.stringify(previous.spec.timeWindow) !==
        JSON.stringify(spec.timeWindow));
  const [row] = await db
    .update(sloDefinitions)
    .set({
      repoid,
      ...(spec
        ? {
            spec,
            nextEvaluationAt: new Date(),
            ...(budgetChanged ? { budgetEpoch: new Date() } : {}),
          }
        : {}),
      version: version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(sloDefinitions.organizationId, organizationId),
        eq(sloDefinitions.id, id),
        eq(sloDefinitions.version, version),
        isNull(sloDefinitions.previewId),
      ),
    )
    .returning();
  if (!row) error(409, "conflict", `SLO version changed: ${id}`);
  if (spec) {
    await enqueueSloEvaluation({
      sloDefinitionId: row.id,
      scheduledFor: row.nextEvaluationAt.toISOString(),
      sloVersion: row.version,
    });
  }
  return sloBase(row);
}

export async function updateSlo(
  organizationId: string,
  id: string,
  rawInput: AlertingSloUpdate,
  version?: number,
) {
  const spec = AlertingSloUpdateSchema.parse(rawInput);
  const previous = await getSloRow(organizationId, id);
  if (version !== undefined && previous.version !== version) {
    error(409, "conflict", `SLO version changed: ${id}`);
  }
  const budgetChanged =
    previous.spec.sli.sql !== spec.sli.sql ||
    previous.spec.targetPercent !== spec.targetPercent ||
    JSON.stringify(previous.spec.timeWindow) !==
      JSON.stringify(spec.timeWindow);
  const [row] = await db
    .update(sloDefinitions)
    .set({
      spec,
      version: previous.version + 1,
      nextEvaluationAt: new Date(),
      updatedAt: new Date(),
      ...(budgetChanged ? { budgetEpoch: new Date() } : {}),
    })
    .where(
      and(
        eq(sloDefinitions.organizationId, organizationId),
        eq(sloDefinitions.id, id),
        eq(sloDefinitions.version, previous.version),
      ),
    )
    .returning();
  if (!row) error(409, "conflict", `SLO version changed: ${id}`);
  await enqueueSloEvaluation({
    sloDefinitionId: row.id,
    scheduledFor: row.nextEvaluationAt.toISOString(),
    sloVersion: row.version,
  });
  return sloBase(row);
}

export async function deleteSlo(organizationId: string, id: string) {
  const rows = await db
    .delete(sloDefinitions)
    .where(
      and(
        eq(sloDefinitions.organizationId, organizationId),
        eq(sloDefinitions.id, id),
      ),
    )
    .returning({ id: sloDefinitions.id });
  return { deleted: rows.length > 0 };
}

export async function pauseSlo(organizationId: string, id: string) {
  const [row] = await db
    .update(sloDefinitions)
    .set({ paused: true, updatedAt: new Date() })
    .where(
      and(
        eq(sloDefinitions.organizationId, organizationId),
        eq(sloDefinitions.id, id),
      ),
    )
    .returning();
  if (!row) error(404, "not_found", `SLO not found: ${id}`);
  return sloBase(row);
}

export async function resumeSlo(organizationId: string, id: string) {
  const [row] = await db
    .update(sloDefinitions)
    .set({ paused: false, nextEvaluationAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(sloDefinitions.organizationId, organizationId),
        eq(sloDefinitions.id, id),
      ),
    )
    .returning();
  if (!row) error(404, "not_found", `SLO not found: ${id}`);
  await enqueueSloEvaluation({
    sloDefinitionId: row.id,
    scheduledFor: row.nextEvaluationAt.toISOString(),
    sloVersion: row.version,
  });
  return sloBase(row);
}

export async function testSlo(
  organizationId: string,
  rawSpec: AlertingSloSpec,
) {
  const spec = AlertingSloSpecSchema.parse(rawSpec);
  const durationSeconds = parseSloWindowSeconds(spec.timeWindow.duration);
  const end = new Date(Date.now() - ALERTING_SLO_INGEST_DELAY_SECS * 1000);
  const start = new Date(end.getTime() - durationSeconds * 1000);
  const [row] = await querySqlApi<{
    good: number | string;
    valid: number | string;
  }>(spec.sli.sql, organizationId, {
    window_start: alertingFormatClickHouseDateTime(start),
    window_end: alertingFormatClickHouseDateTime(end),
  });
  const good = Number(row?.good ?? 0);
  const valid = Number(row?.valid ?? 0);
  if (!Number.isFinite(good) || !Number.isFinite(valid)) {
    error(
      422,
      "validation",
      "SLI query must return numeric good and valid columns",
    );
  }
  return { good, valid, sli: valid > 0 ? good / valid : null };
}

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
  const [row] = await translateConflict(() =>
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
  if (!row) error(404, "not_found", `Channel not found: ${name}`);
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
  const [row] = await translateConflict(() =>
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
    error(
      409,
      "conflict",
      `Channel is used by receivers: ${receiverRefs.map((r) => r.receiver).join(", ")}`,
    );
  }
  if (definitionRefs.length > 0) {
    error(
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
    error(409, "conflict", "Channel is referenced by notification history");
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
    const { sendChannelTest } = await import("@/server/alerts/channels");
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
): Promise<string[]> {
  if (names.length === 0) error(422, "validation", "receiver needs a channel");
  const rows = await db
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
  if (missing.length > 0)
    error(422, "validation", `Unknown channels: ${missing.join(", ")}`);
  return names.map((name) => byName.get(name) as string);
}

async function resolveOptionalChannelIds(
  organizationId: string,
  names: string[],
): Promise<string[]> {
  return names.length === 0 ? [] : resolveChannelIds(organizationId, names);
}

export async function createReceiver(
  organizationId: string,
  body: { name: string; channels: string[] },
) {
  const channelIds = await resolveChannelIds(organizationId, body.channels);
  return translateConflict(() =>
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
  if (!row) error(404, "not_found", `Receiver not found: ${name}`);
  return row;
}

export async function updateReceiver(
  organizationId: string,
  name: string,
  body: { name?: string; channels: string[] },
) {
  const previous = await getReceiverRow(organizationId, name);
  const channelIds = await resolveChannelIds(organizationId, body.channels);
  return translateConflict(() =>
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
    error(409, "conflict", `Receiver is used by ${routes.length} route(s)`);
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
  if (!row) error(404, "not_found", `Route not found: ${id}`);
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

export async function listSilences(organizationId: string) {
  const rows = await db
    .select()
    .from(alertSilences)
    .where(eq(alertSilences.organizationId, organizationId))
    .orderBy(desc(alertSilences.createdAt));
  return rows.map((row) => ({
    id: row.id,
    tenant: row.organizationId,
    matchers: row.matchers,
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt.toISOString(),
    comment: row.comment,
    author: row.author,
    created_at: row.createdAt.toISOString(),
  }));
}

export async function createSilence(
  organizationId: string,
  rawInput: AlertingSilenceInput,
) {
  const input = AlertingSilenceInputSchema.parse(rawInput);
  const startsAt = new Date(input.starts_at);
  const endsAt = new Date(input.ends_at);
  if (!(endsAt > startsAt))
    error(422, "validation", "silence ends_at must be after starts_at");
  const [row] = await db
    .insert(alertSilences)
    .values({
      organizationId,
      startsAt,
      endsAt,
      comment: input.comment ?? "",
      author: input.author ?? "",
      matchers: input.matchers,
    })
    .returning();
  return {
    id: row.id,
    tenant: row.organizationId,
    matchers: row.matchers,
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt.toISOString(),
    comment: row.comment,
    author: row.author,
    created_at: row.createdAt.toISOString(),
  };
}

export async function deleteSilence(organizationId: string, id: string) {
  const rows = await db
    .delete(alertSilences)
    .where(
      and(
        eq(alertSilences.organizationId, organizationId),
        eq(alertSilences.id, id),
      ),
    )
    .returning({ id: alertSilences.id });
  return { deleted: rows.length > 0 };
}
