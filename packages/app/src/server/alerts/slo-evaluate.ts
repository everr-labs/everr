import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ALERTING_SLO_INGEST_DELAY_SECS,
  alertingFormatClickHouseDateTime,
  alertingSloCurrentBurn,
  alertingSloTiers,
  alertingTimeToExhaustionSecs,
} from "@/data/alerting/slo";
import type { AlertingSloStatusPayload } from "@/data/alerting/types";
import { parseSloWindowSeconds } from "@/data/slos/schema";
import { db } from "@/db/client";
import {
  alertEvents,
  sloAlertInstances,
  sloDefinitions,
  sloEvaluations,
} from "@/db/schema";
import { querySqlApi } from "@/lib/clickhouse";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";
import { errorMessage } from "@/telemetry/logger";
import {
  alertingPartitionQueue,
  type EvaluateSloPayload,
  SLO_EVALUATE_TASK,
  sloEvaluationJobKey,
} from "./01-scanner";
import { ALERT_PROCESS_EVENT_TASK } from "./dispatcher";

const PayloadSchema = z.object({
  sloDefinitionId: z.string().uuid(),
  scheduledFor: z.string().datetime(),
  sloVersion: z.number().int().positive().optional(),
});
const BASE_CADENCE_SECONDS = 60;

function durationSeconds(value: string) {
  const match = /^(\d+)([smhdw])$/.exec(value);
  if (!match) throw new Error(`invalid SLO tier duration: ${value}`);
  const unit = { s: 1, m: 60, h: 3_600, d: 86_400, w: 604_800 } as const;
  return Number(match[1]) * unit[match[2] as keyof typeof unit];
}

function burnRate(good: number, valid: number, targetPercent: number) {
  if (!(valid > 0)) return null;
  const budget = 1 - targetPercent / 100;
  if (!(budget > 0)) return null;
  return (1 - good / valid) / budget;
}

function numberValue(value: unknown, column: "good" | "valid") {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`SLI query must return a non-negative numeric ${column}`);
  }
  return parsed;
}

async function queryWindow(
  sqlText: string,
  organizationId: string,
  end: Date,
  seconds: number,
) {
  const start = new Date(end.getTime() - seconds * 1_000);
  const rows = await querySqlApi<{
    good?: number | string;
    valid?: number | string;
  }>(sqlText, organizationId, {
    window_start: alertingFormatClickHouseDateTime(start),
    window_end: alertingFormatClickHouseDateTime(end),
  });
  if (rows.length > 1) throw new Error("SLI query must return at most one row");
  const good = numberValue(rows[0]?.good ?? 0, "good");
  const valid = numberValue(rows[0]?.valid ?? 0, "valid");
  if (good > valid) {
    throw new Error("SLI query returned good greater than valid");
  }
  return { good, valid };
}

async function scheduleNext(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  slo: typeof sloDefinitions.$inferSelect,
  now: Date,
) {
  const runAt = new Date(now.getTime() + BASE_CADENCE_SECONDS * 1_000);
  const payload: EvaluateSloPayload = {
    sloDefinitionId: slo.id,
    scheduledFor: runAt.toISOString(),
    sloVersion: slo.version,
  };
  await tx
    .update(sloDefinitions)
    .set({ nextEvaluationAt: runAt })
    .where(eq(sloDefinitions.id, slo.id));
  await addWorkerJobInTransaction(tx, SLO_EVALUATE_TASK, payload, {
    jobKey: sloEvaluationJobKey(slo.id, payload.scheduledFor),
    jobKeyMode: "replace",
    maxAttempts: 5,
    queueName: alertingPartitionQueue("slo", slo.id),
    runAt,
  });
}

async function failEvaluation(
  slo: typeof sloDefinitions.$inferSelect,
  scheduledFor: Date,
  cause: unknown,
) {
  const message = errorMessage(cause).slice(0, 8_000);
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(sloEvaluations)
      .values({ sloDefinitionId: slo.id, scheduledFor, error: message })
      .onConflictDoNothing()
      .returning({ id: sloEvaluations.sloDefinitionId });
    if (inserted.length === 0) return;
    await tx
      .update(sloDefinitions)
      .set({
        lastError: message,
        lastErrorAt: new Date(),
        consecutiveFailures: sql`${sloDefinitions.consecutiveFailures} + 1`,
        healthStatus: sql`CASE WHEN ${sloDefinitions.consecutiveFailures} + 1 >= 3 THEN 'degraded'::alert_health ELSE ${sloDefinitions.healthStatus} END`,
        degradedSince: sql`CASE WHEN ${sloDefinitions.consecutiveFailures} + 1 >= 3 THEN coalesce(${sloDefinitions.degradedSince}, now()) ELSE ${sloDefinitions.degradedSince} END`,
      })
      .where(eq(sloDefinitions.id, slo.id));
    await scheduleNext(tx, slo, new Date());
  });
}

export async function evaluateSlo(rawPayload: unknown): Promise<void> {
  const payload = PayloadSchema.parse(rawPayload);
  const scheduledFor = new Date(payload.scheduledFor);
  const [slo] = await db
    .select()
    .from(sloDefinitions)
    .where(eq(sloDefinitions.id, payload.sloDefinitionId))
    .limit(1);
  if (
    !slo ||
    slo.paused ||
    (payload.sloVersion !== undefined && payload.sloVersion !== slo.version)
  )
    return;
  const now = new Date();
  const queryEnd = new Date(
    now.getTime() - ALERTING_SLO_INGEST_DELAY_SECS * 1_000,
  );
  const tiers = alertingSloTiers(slo.spec);
  const budgetSeconds = parseSloWindowSeconds(slo.spec.timeWindow.duration);
  const required = new Set<number>([budgetSeconds]);
  for (const tier of tiers) {
    required.add(durationSeconds(tier.long_window));
    required.add(durationSeconds(tier.short_window));
  }
  const prior = slo.status;
  const freshness = prior?.window_computed_at ?? {};
  const nowUnix = Math.floor(now.getTime() / 1_000);
  const due = [...required].filter((seconds) => {
    const last = freshness[`${seconds}s`];
    return (
      last === undefined ||
      nowUnix - last >= Math.max(BASE_CADENCE_SECONDS, Math.floor(seconds / 12))
    );
  });
  let values: Map<number, { good: number; valid: number }>;
  try {
    values = new Map(
      await Promise.all(
        due.map(
          async (seconds) =>
            [
              seconds,
              await queryWindow(
                slo.spec.sli.sql,
                slo.organizationId,
                queryEnd,
                seconds,
              ),
            ] as const,
        ),
      ),
    );
  } catch (cause) {
    await failEvaluation(slo, scheduledFor, cause);
    return;
  }

  const priorTiers = new Map(
    (prior?.tiers ?? []).map((tier) => [tier.name, tier]),
  );
  const tierStatus = tiers.map((tier) => {
    const previous = priorTiers.get(tier.name);
    const long = values.get(durationSeconds(tier.long_window));
    const short = values.get(durationSeconds(tier.short_window));
    return {
      name: tier.name,
      long_burn_rate: long
        ? burnRate(long.good, long.valid, slo.spec.targetPercent)
        : (previous?.long_burn_rate ?? null),
      short_burn_rate: short
        ? burnRate(short.good, short.valid, slo.spec.targetPercent)
        : (previous?.short_burn_rate ?? null),
      long_window_valid: long?.valid ?? previous?.long_window_valid ?? null,
    };
  });
  const budget = values.get(budgetSeconds);
  const sli = budget
    ? budget.valid > 0
      ? budget.good / budget.valid
      : null
    : (prior?.sli ?? null);
  const budgetRemaining = budget
    ? burnRate(budget.good, budget.valid, slo.spec.targetPercent) === null
      ? null
      : 1 - (burnRate(budget.good, budget.valid, slo.spec.targetPercent) ?? 0)
    : (prior?.budget_remaining ?? null);
  const tiersByName = new Map(tiers.map((tier) => [tier.name, tier]));
  const firing = tierStatus.filter((status) => {
    const tier = tiersByName.get(status.name);
    if (!tier) return false;
    const enough =
      slo.spec.min_valid_events === undefined ||
      (status.long_window_valid ?? 0) >= slo.spec.min_valid_events;
    return (
      enough &&
      status.long_burn_rate !== null &&
      status.short_burn_rate !== null &&
      status.long_burn_rate >= tier.burn_rate &&
      status.short_burn_rate >= tier.burn_rate
    );
  });
  const firingNames = new Set(firing.map((tier) => tier.name));
  const status: AlertingSloStatusPayload = {
    window: slo.spec.timeWindow.duration,
    target_percent: slo.spec.targetPercent,
    sli,
    budget_remaining: budgetRemaining,
    tiers: tierStatus,
    firing_tiers: firing.map((tier) => ({ tier: tier.name, status: "firing" })),
    window_computed_at: {
      ...freshness,
      ...Object.fromEntries(due.map((seconds) => [`${seconds}s`, nowUnix])),
    },
    time_to_exhaustion_secs: null,
  };
  status.time_to_exhaustion_secs = alertingTimeToExhaustionSecs(
    status.budget_remaining,
    alertingSloCurrentBurn(tiers, status.tiers)?.effective ?? null,
    budgetSeconds,
  );
  const previousInstances = await db
    .select()
    .from(sloAlertInstances)
    .where(eq(sloAlertInstances.sloDefinitionId, slo.id));
  const previousByTier = new Map(
    previousInstances.map((item) => [item.tier, item]),
  );

  await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select({
        paused: sloDefinitions.paused,
        version: sloDefinitions.version,
      })
      .from(sloDefinitions)
      .where(eq(sloDefinitions.id, slo.id))
      .for("update")
      .limit(1);
    if (!fresh || fresh.paused || fresh.version !== slo.version) return;
    const inserted = await tx
      .insert(sloEvaluations)
      .values({ sloDefinitionId: slo.id, scheduledFor })
      .onConflictDoNothing()
      .returning({ id: sloEvaluations.sloDefinitionId });
    if (inserted.length === 0) return;
    const eventValues: (typeof alertEvents.$inferInsert)[] = [];
    for (const tier of tiers) {
      const previous = previousByTier.get(tier.name);
      const isFiring = firingNames.has(tier.name);
      const wasFiring = previous?.status === "firing";
      const tierValue =
        tierStatus.find((item) => item.name === tier.name)?.long_burn_rate ??
        null;
      const sloName = `${slo.project}/${slo.slug}`;
      const labels = {
        slo_tier: tier.name,
        slo: sloName,
      };
      await tx
        .insert(sloAlertInstances)
        .values({
          organizationId: slo.organizationId,
          sloDefinitionId: slo.id,
          tier: tier.name,
          status: isFiring ? "firing" : "inactive",
          labels,
          value: tierValue,
          activeSince: isFiring ? (previous?.activeSince ?? now) : null,
          lastSeenAt: isFiring ? now : (previous?.lastSeenAt ?? null),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [sloAlertInstances.sloDefinitionId, sloAlertInstances.tier],
          set: {
            status: isFiring ? "firing" : "inactive",
            labels,
            value: tierValue,
            activeSince: isFiring ? (previous?.activeSince ?? now) : null,
            lastSeenAt: isFiring ? now : (previous?.lastSeenAt ?? null),
            updatedAt: now,
          },
        });
      if (isFiring !== wasFiring) {
        eventValues.push({
          organizationId: slo.organizationId,
          repoid: slo.repoid,
          previewId: slo.previewId,
          sourceKind: "slo",
          sourceDefinitionId: slo.id,
          slug: sloName,
          eventType: isFiring ? "instance_fired" : "instance_resolved",
          instanceFingerprint: tier.name,
          instanceLabels: labels,
          severity: tier.severity,
          notificationTitle: `${sloName} SLO ${tier.name} burn rate`,
          notificationDescription: isFiring
            ? `Burn rate ${tierValue ?? "unknown"} exceeded ${tier.burn_rate}`
            : `Burn rate recovered below ${tier.burn_rate}`,
          suppressed: slo.spec.suppressed || slo.previewId !== null,
          evidence: { burn_rate: tierValue, threshold: tier.burn_rate },
          occurredAt: now,
        });
      }
    }
    await tx
      .update(sloDefinitions)
      .set({
        status,
        statusComputedAt: now,
        healthStatus: "healthy",
        consecutiveFailures: 0,
        degradedSince: null,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(sloDefinitions.id, slo.id));
    if (eventValues.length > 0) {
      const events = await tx
        .insert(alertEvents)
        .values(eventValues)
        .returning({ id: alertEvents.id });
      for (const event of events) {
        await addWorkerJobInTransaction(
          tx,
          ALERT_PROCESS_EVENT_TASK,
          { eventId: event.id },
          {
            jobKey: `${ALERT_PROCESS_EVENT_TASK}:${event.id}`,
            jobKeyMode: "replace",
            maxAttempts: 5,
          },
        );
      }
    }
    await scheduleNext(tx, slo, now);
  });
}
