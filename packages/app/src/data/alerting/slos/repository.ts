import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { parseResourceName } from "@/data/as-code/identity";
import { db } from "@/db/client";
import { sloDefinitions } from "@/db/schema";
import { querySqlApi } from "@/lib/clickhouse";
import {
  throwAlertingPersistenceError,
  translateAlertingConflict,
} from "../persistence";
import {
  enqueueSloEvaluation,
  nextSloEvaluationAt,
} from "../scheduling/evaluation-jobs.server";
import {
  AlertingSloInputSchema,
  AlertingSloSpecSchema,
  AlertingSloUpdateSchema,
} from "../schema";
import type {
  AlertingSloInput,
  AlertingSloSpec,
  AlertingSloUpdate,
} from "../types";
import {
  ALERTING_SLO_INGEST_DELAY_SECS,
  alertingFormatClickHouseDateTime,
} from "./model";
import { parseSloWindowSeconds } from "./resource/schema";

type SloRow = typeof sloDefinitions.$inferSelect;

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
  if (!row) {
    throwAlertingPersistenceError(404, "not_found", `SLO not found: ${id}`);
  }
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
  const id = randomUUID();
  const [row] = await translateAlertingConflict(() =>
    db
      .insert(sloDefinitions)
      .values({
        id,
        organizationId,
        repoid,
        previewId,
        project,
        slug,
        spec,
        nextEvaluationAt: nextSloEvaluationAt(organizationId, id),
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
  if (repoid.length === 0) {
    throwAlertingPersistenceError(422, "validation", "repoid is required");
  }
  const previous = await getSloRow(organizationId, id);
  if (previous.version !== version || previous.previewId !== null) {
    throwAlertingPersistenceError(
      409,
      "conflict",
      `SLO version changed: ${id}`,
    );
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
            nextEvaluationAt: nextSloEvaluationAt(organizationId, id),
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
  if (!row) {
    throwAlertingPersistenceError(
      409,
      "conflict",
      `SLO version changed: ${id}`,
    );
  }
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
    throwAlertingPersistenceError(
      409,
      "conflict",
      `SLO version changed: ${id}`,
    );
  }
  const budgetChanged =
    previous.spec.sli.sql !== spec.sli.sql ||
    previous.spec.targetPercent !== spec.targetPercent ||
    JSON.stringify(previous.spec.timeWindow) !==
      JSON.stringify(spec.timeWindow);
  const nextEvaluationAt = nextSloEvaluationAt(organizationId, id);
  const [row] = await db
    .update(sloDefinitions)
    .set({
      spec,
      version: previous.version + 1,
      nextEvaluationAt,
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
  if (!row) {
    throwAlertingPersistenceError(
      409,
      "conflict",
      `SLO version changed: ${id}`,
    );
  }
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
  if (!row) {
    throwAlertingPersistenceError(404, "not_found", `SLO not found: ${id}`);
  }
  return sloBase(row);
}

export async function resumeSlo(organizationId: string, id: string) {
  const nextEvaluationAt = nextSloEvaluationAt(organizationId, id);
  const [row] = await db
    .update(sloDefinitions)
    .set({ paused: false, nextEvaluationAt, updatedAt: new Date() })
    .where(
      and(
        eq(sloDefinitions.organizationId, organizationId),
        eq(sloDefinitions.id, id),
      ),
    )
    .returning();
  if (!row) {
    throwAlertingPersistenceError(404, "not_found", `SLO not found: ${id}`);
  }
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
    throwAlertingPersistenceError(
      422,
      "validation",
      "SLI query must return numeric good and valid columns",
    );
  }
  return { good, valid, sli: valid > 0 ? good / valid : null };
}
