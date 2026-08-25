import { randomUUID } from "node:crypto";
import { toClickHouseDateTime } from "@everr/ui/lib/time-range";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { formatResourceName, parseResourceName } from "@/data/as-code/identity";
import {
  type DbExecutor,
  db,
  runInTransaction,
  type Transaction,
} from "@/db/client";
import { alertDefinitions, alertInstances } from "@/db/schema";
import { query } from "@/lib/clickhouse";
import { clickhouseIsoMillis } from "../history/clickhouse";
import {
  throwAlertingPersistenceError,
  translateAlertingConflict,
} from "../persistence";
import {
  enqueueAlertEvaluation,
  enqueueAlertEvaluationInTransaction,
  nextAlertEvaluationAt,
} from "../scheduling/evaluation-jobs.server";
import {
  AlertingRuleInputSchema,
  AlertingRuleSpecSchema,
  AlertingRuleUpdateSchema,
} from "../schema";
import type { AlertingMutationScope } from "../session";
import type {
  AlertingRuleHealthStatus,
  AlertingRuleInput,
  AlertingRuleUpdate,
} from "../types";
import {
  parseAlertEvaluationSamples,
  shapeAlertEvaluationSeries,
} from "./evaluation-series";
import { closeRuleLifecycle } from "./lifecycle.server";

type RuleRow = typeof alertDefinitions.$inferSelect;

function ruleName(row: RuleRow): string {
  return formatResourceName(row.project, row.slug);
}

function ruleBase(row: RuleRow) {
  return {
    id: row.id,
    tenant: row.organizationId,
    repoid: row.repoid,
    previewId: row.previewId,
    name: ruleName(row),
    spec: row.spec,
    version: row.version,
    paused: !row.active,
  };
}

/**
 * The rollup state a stored definition state renders as. `pending` is a
 * breach inside its for-duration and must stay distinguishable from OK;
 * `unknown` and `resolved` both read as inactive.
 */
export function rollupAlertState(
  currentState: RuleRow["currentState"],
): "inactive" | "pending" | "firing" {
  switch (currentState) {
    case "firing":
      return "firing";
    case "pending":
      return "pending";
    default:
      return "inactive";
  }
}

/**
 * `degraded_since` is non-null exactly while the rule is degraded, so the
 * status is read off it rather than stored beside it.
 */
function ruleHealthStatus(
  degradedSince: Date | null,
): AlertingRuleHealthStatus {
  return degradedSince === null ? "healthy" : "degraded";
}

function ruleView(row: RuleRow) {
  return {
    ...ruleBase(row),
    updated_at: row.updatedAt.toISOString(),
    health: {
      status: ruleHealthStatus(row.degradedSince),
      consecutive_failures: row.consecutiveFailures,
      degraded_since: row.degradedSince?.toISOString() ?? null,
      last_error: row.lastError,
      last_error_at: row.lastErrorAt?.toISOString() ?? null,
    },
    rollup: {
      alert_state: rollupAlertState(row.currentState),
      firing_instance_count: row.firingInstanceCount,
      last_fired_at: row.lastFiredAt?.toISOString() ?? null,
      last_resolved_at: row.lastResolvedAt?.toISOString() ?? null,
      last_seen_at: row.lastSeenAt?.toISOString() ?? null,
      next_evaluation_at: row.nextEvaluationAt?.toISOString() ?? null,
      last_row_count: row.lastRowCount,
    },
  };
}

function encodeOffset(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const value = Number(Buffer.from(cursor, "base64url").toString("utf8"));
  if (!Number.isSafeInteger(value) || value < 0) {
    throwAlertingPersistenceError(
      422,
      "validation",
      "invalid pagination cursor",
    );
  }
  return value;
}

async function listRulesPage(
  organizationId: string,
  opts: {
    limit?: number;
    cursor?: string;
    previewId?: string | null;
    name?: string;
  } = {},
  executor: DbExecutor = db,
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
  const rows = await executor
    .select()
    .from(alertDefinitions)
    .where(and(...filters))
    .orderBy(desc(alertDefinitions.updatedAt), desc(alertDefinitions.id))
    .limit(limit + 1)
    .offset(offset);
  const pageRows = rows.slice(0, limit);
  return {
    items: pageRows.map((row) => ruleView(row)),
    next_cursor: rows.length > limit ? encodeOffset(offset + limit) : null,
  };
}

export async function listAllRules(
  organizationId: string,
  opts: { previewId?: string | null; name?: string } = {},
  executor: DbExecutor = db,
) {
  const all: ReturnType<typeof ruleView>[] = [];
  let cursor: string | undefined;
  do {
    const page = await listRulesPage(
      organizationId,
      {
        ...opts,
        limit: 500,
        ...(cursor ? { cursor } : {}),
      },
      executor,
    );
    all.push(...page.items);
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
  return all;
}

async function getRuleRow(
  organizationId: string,
  id: string,
  executor: DbExecutor = db,
): Promise<RuleRow> {
  const [row] = await executor
    .select()
    .from(alertDefinitions)
    .where(
      and(
        eq(alertDefinitions.organizationId, organizationId),
        eq(alertDefinitions.id, id),
      ),
    )
    .limit(1);
  if (!row)
    throwAlertingPersistenceError(404, "not_found", `Rule not found: ${id}`);
  return row;
}

export async function getRule(organizationId: string, id: string) {
  const row = await getRuleRow(organizationId, id);
  return ruleView(row);
}

// Bounds transfer and server memory for pathological windows: samples_json
// rides every row, so an uncapped month at a one-minute cadence is tens of
// thousands of rows. Newest rows win; the shaper reduces further to the
// display budget.
const EVALUATION_SERIES_ROW_CAP = 20_000;

// The window is asked for in scheduled time, but only `event_time` is in the
// partition key and the sort key, so a bound on it is what prunes. An
// evaluation writes its row within a run of being due, and a day of slack
// covers any backlog that is not already an incident.
//
// Without this, the read falls back to a bloom probe over the tenant's whole
// evaluation stream, which is two orders of magnitude larger than everything
// else in the table.
const EVALUATION_EVENT_TIME_SLACK_MS = 24 * 60 * 60 * 1_000;

export async function getRuleEvaluationSeries(
  organizationId: string,
  id: string,
  opts: { from: Date; to: Date; points: number },
) {
  const def = await getRuleRow(organizationId, id);
  const rows = await query<{
    scheduledFor: string;
    eventType: "evaluation_succeeded" | "evaluation_failed";
    error: string;
    rowCount: number;
    samplesJson: string;
    samplesTruncated: boolean;
  }>(
    `
      SELECT
        ${clickhouseIsoMillis("evaluation_scheduled_at")} AS scheduledFor,
        event_type AS eventType,
        error,
        row_count AS rowCount,
        samples_json AS samplesJson,
        samples_truncated AS samplesTruncated
      FROM app.alert_events
      WHERE tenant_id = {organizationId:String}
        AND repoid = {repoid:String}
        AND slug = {slug:String}
        AND event_type IN ('evaluation_succeeded', 'evaluation_failed')
        AND alert_definition_id = {alertDefinitionId:UUID}
        AND event_time >= {eventFrom:DateTime64(3)}
        AND event_time <= {eventTo:DateTime64(3)}
        AND evaluation_scheduled_at >= {from:DateTime64(3)}
        AND evaluation_scheduled_at <= {to:DateTime64(3)}
      ORDER BY evaluation_scheduled_at DESC
      LIMIT {rowCap:UInt32}
    `,
    organizationId,
    {
      organizationId,
      repoid: def.repoid,
      // The history column holds the qualified name, not the bare slug.
      slug: ruleName(def),
      alertDefinitionId: id,
      from: toClickHouseDateTime(opts.from),
      to: toClickHouseDateTime(opts.to),
      eventFrom: toClickHouseDateTime(
        new Date(opts.from.getTime() - EVALUATION_EVENT_TIME_SLACK_MS),
      ),
      eventTo: toClickHouseDateTime(
        new Date(opts.to.getTime() + EVALUATION_EVENT_TIME_SLACK_MS),
      ),
      rowCap: EVALUATION_SERIES_ROW_CAP,
    },
  );
  rows.reverse();
  return shapeAlertEvaluationSeries(
    rows.map((row) => ({
      scheduledFor: new Date(row.scheduledFor),
      error: row.eventType === "evaluation_failed" ? row.error : null,
      rowCount:
        row.eventType === "evaluation_failed" ? null : Number(row.rowCount),
      samples: parseAlertEvaluationSamples(row.samplesJson),
      samplesTruncated: Boolean(row.samplesTruncated),
    })),
    opts.points,
    def.spec.condition,
  );
}

// instanceFingerprint sorts label keys before hashing, so a reorder of
// label_columns with the same membership is a no-op for every open
// instance. Comparing the raw arrays would close and re-fire them on a
// reorder alone.
function labelColumnsChanged(
  previous: readonly string[],
  next: readonly string[],
): boolean {
  return (
    JSON.stringify([...previous].sort()) !== JSON.stringify([...next].sort())
  );
}

function definitionValues(
  id: string,
  organizationId: string,
  input: AlertingRuleInput,
) {
  const { project, slug } = parseResourceName(input.name);
  const spec = AlertingRuleSpecSchema.parse(input);
  return {
    id,
    organizationId,
    repoid: input.repoid,
    previewId: input.previewId,
    project,
    slug,
    spec,
    nextEvaluationAt: nextAlertEvaluationAt(
      organizationId,
      id,
      spec.interval_secs,
    ),
    active: true,
  };
}

// In-transaction so the evaluation job cannot outlive a rolled-back rule,
// and a mutated rule is never left unscheduled by a crash.
function scheduleEvaluation(tx: Transaction, row: RuleRow): Promise<void> {
  return enqueueAlertEvaluationInTransaction(tx, {
    alertDefinitionId: row.id,
    scheduledFor:
      row.nextEvaluationAt?.toISOString() ?? new Date().toISOString(),
    ruleVersion: row.version,
  });
}

// The executor is required on every mutation: a defaulted `db` would let a
// missed call site silently escape the caller's transaction.
export async function createRule(
  organizationId: string,
  rawInput: AlertingRuleInput,
  executor: DbExecutor,
) {
  const input = AlertingRuleInputSchema.parse(rawInput);
  const id = randomUUID();
  const row = await translateAlertingConflict(() =>
    runInTransaction(executor, async (tx) => {
      const [created] = await tx
        .insert(alertDefinitions)
        .values(definitionValues(id, organizationId, input))
        .returning();
      await scheduleEvaluation(tx, created);
      return created;
    }),
  );
  return ruleBase(row);
}

export async function updateRule(
  organizationId: string,
  id: string,
  rawSpec: AlertingRuleUpdate,
  version: number | undefined,
  executor: DbExecutor,
) {
  const spec = AlertingRuleUpdateSchema.parse(rawSpec);
  const previous = await getRuleRow(organizationId, id, executor);
  if (version !== undefined && previous.version !== version) {
    throwAlertingPersistenceError(
      409,
      "conflict",
      `Rule version changed: ${id}`,
    );
  }
  const labelsChanged = labelColumnsChanged(
    previous.spec.label_columns,
    spec.label_columns,
  );
  const nextEvaluationAt = nextAlertEvaluationAt(
    organizationId,
    id,
    spec.interval_secs,
  );
  const now = new Date();
  const updated = await translateAlertingConflict(() =>
    runInTransaction(executor, async (tx) => {
      const [row] = await tx
        .update(alertDefinitions)
        .set({
          spec,
          version: previous.version + 1,
          nextEvaluationAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(alertDefinitions.organizationId, organizationId),
            eq(alertDefinitions.id, id),
            eq(alertDefinitions.version, previous.version),
          ),
        )
        .returning();
      if (!row)
        throwAlertingPersistenceError(
          409,
          "conflict",
          `Rule version changed: ${id}`,
        );
      if (labelsChanged) {
        // New label columns mean new fingerprints, so the old instances can
        // never match again. They still must end like any other destruction:
        // terminals journaled and in-flight events canceled, or their open
        // episodes dangle forever and fired chains die without a record.
        await closeRuleLifecycle(tx, row, "labels_changed", now);
        await tx
          .delete(alertInstances)
          .where(eq(alertInstances.alertDefinitionId, id));
      }
      await scheduleEvaluation(tx, row);
      return row;
    }),
  );
  return ruleBase(updated);
}

export async function adoptRule(
  organizationId: string,
  id: string,
  repoid: string,
  version: number,
  rawSpec: AlertingRuleUpdate | undefined,
  executor: DbExecutor,
) {
  if (repoid.length === 0)
    throwAlertingPersistenceError(422, "validation", "repoid is required");
  const previous = await getRuleRow(organizationId, id, executor);
  if (previous.version !== version || previous.previewId !== null) {
    throwAlertingPersistenceError(
      409,
      "conflict",
      `Rule version changed: ${id}`,
    );
  }
  const spec = rawSpec ? AlertingRuleUpdateSchema.parse(rawSpec) : null;
  const labelsChanged =
    spec !== null &&
    labelColumnsChanged(previous.spec.label_columns, spec.label_columns);
  const row = await translateAlertingConflict(() =>
    runInTransaction(executor, async (tx) => {
      const [updated] = await tx
        .update(alertDefinitions)
        .set({
          repoid,
          ...(spec
            ? {
                spec,
                nextEvaluationAt: nextAlertEvaluationAt(
                  organizationId,
                  id,
                  spec.interval_secs,
                ),
              }
            : {}),
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
      if (!updated)
        throwAlertingPersistenceError(
          409,
          "conflict",
          `Rule version changed: ${id}`,
        );
      if (labelsChanged) {
        // Same contract as updateRule: close before the fingerprints change.
        await closeRuleLifecycle(tx, updated, "labels_changed", new Date());
        await tx
          .delete(alertInstances)
          .where(eq(alertInstances.alertDefinitionId, id));
      }
      if (spec) await scheduleEvaluation(tx, updated);
      return updated;
    }),
  );
  return ruleBase(row);
}

export async function deleteRule(
  organizationId: string,
  id: string,
  executor: DbExecutor,
) {
  const now = new Date();
  return await runInTransaction(executor, async (tx) => {
    const [def] = await tx
      .select()
      .from(alertDefinitions)
      .where(
        and(
          eq(alertDefinitions.organizationId, organizationId),
          eq(alertDefinitions.id, id),
        ),
      )
      .limit(1);
    if (!def) return { deleted: false };
    // The terminals must be journaled before the cascade forgets the open
    // instances; the journal rows themselves have no FK to the definition,
    // so they outlive it.
    await closeRuleLifecycle(tx, def, "rule_deleted", now);
    await tx
      .delete(alertDefinitions)
      .where(
        and(
          eq(alertDefinitions.organizationId, organizationId),
          eq(alertDefinitions.id, id),
        ),
      );
    return { deleted: true };
  });
}

export async function pauseRule(
  { organizationId }: AlertingMutationScope,
  id: string,
) {
  const now = new Date();
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(alertDefinitions)
      .set({
        active: false,
        // The rollup must not keep reporting a firing state the pause just
        // closed; resume re-derives it from scratch. Health resets the same
        // way: a rule paused mid-degradation must not read degraded forever,
        // or resume near the retry-backoff ceiling from a streak that never
        // gets to run again.
        currentState: "unknown",
        firingInstanceCount: 0,
        consecutiveFailures: 0,
        degradedSince: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(alertDefinitions.organizationId, organizationId),
          eq(alertDefinitions.id, id),
        ),
      )
      .returning();
    if (!updated)
      throwAlertingPersistenceError(404, "not_found", `Rule not found: ${id}`);
    await closeRuleLifecycle(tx, updated, "rule_paused", now);
    // Reset after the close read the open set, so resume starts from scratch:
    // re-pending, re-firing, re-notifying.
    await tx
      .update(alertInstances)
      .set({
        status: "inactive",
        pendingSince: null,
        activeSince: null,
        absentCount: 0,
        episodeId: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(alertInstances.alertDefinitionId, id),
          ne(alertInstances.status, "inactive"),
        ),
      );
    return updated;
  });
  return ruleBase(row);
}

export async function resumeRule(
  { organizationId }: AlertingMutationScope,
  id: string,
) {
  const previous = await getRuleRow(organizationId, id);
  const nextEvaluationAt = nextAlertEvaluationAt(
    organizationId,
    id,
    previous.spec.interval_secs,
  );
  const [row] = await db
    .update(alertDefinitions)
    .set({ active: true, nextEvaluationAt, updatedAt: new Date() })
    .where(
      and(
        eq(alertDefinitions.organizationId, organizationId),
        eq(alertDefinitions.id, id),
      ),
    )
    .returning();
  if (!row)
    throwAlertingPersistenceError(404, "not_found", `Rule not found: ${id}`);
  await enqueueAlertEvaluation({
    alertDefinitionId: row.id,
    scheduledFor:
      row.nextEvaluationAt?.toISOString() ?? new Date().toISOString(),
    ruleVersion: row.version,
  });
  return ruleBase(row);
}
