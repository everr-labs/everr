import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { alertDefinitions, alertEvents } from "@/db/schema";
import {
  type AlertHistoryDefinition,
  instanceHistoryRow,
  recordAlertHistory,
  suppressionHistoryRow,
  ZERO_UUID,
} from "./clickhouse";
import { alertServiceFallback } from "./content";
import { AlertLifecycleProjectionPayloadSchema } from "./tasks";

/**
 * Project the lifecycle terminals a pause or delete journaled. Runs after the
 * mutation's commit; the journal rows are self-sufficient, so a definition
 * that is already gone (delete) only costs the service-name fallback.
 */
export async function projectAlertLifecycle(
  rawPayload: unknown,
): Promise<void> {
  const payload = AlertLifecycleProjectionPayloadSchema.parse(rawPayload);
  const ids = [
    ...new Set([...payload.closedEventIds, ...payload.suppressedEventIds]),
  ];
  if (ids.length === 0) return;
  const rows = await db
    .select()
    .from(alertEvents)
    .where(inArray(alertEvents.id, ids));
  if (rows.length === 0) return;
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const definitionIds = [...new Set(rows.map((row) => row.sourceDefinitionId))];
  const definitions = await db
    .select({ id: alertDefinitions.id, spec: alertDefinitions.spec })
    .from(alertDefinitions)
    .where(inArray(alertDefinitions.id, definitionIds));
  const specById = new Map(definitions.map((def) => [def.id, def.spec]));

  const historyDef = (
    row: typeof alertEvents.$inferSelect,
  ): AlertHistoryDefinition => ({
    id: row.sourceDefinitionId,
    organizationId: row.organizationId,
    repoid: row.repoid,
    slug: row.slug,
    previewId: row.previewId,
    severity: row.severity,
    ruleMuted: row.suppressed,
    serviceFallback: alertServiceFallback(
      specById.get(row.sourceDefinitionId)?.annotations ?? {},
    ),
  });

  const historyRows = [
    ...payload.closedEventIds.flatMap((id) => {
      const row = rowById.get(id);
      if (!row) return [];
      return [
        instanceHistoryRow({
          def: historyDef(row),
          eventId: row.id,
          eventType: "instance_closed" as const,
          occurredAt: row.occurredAt,
          episodeId: row.episodeId ?? ZERO_UUID,
          fingerprint: row.instanceFingerprint,
          labels: row.instanceLabels,
          evidence: {},
          evidenceTruncated: false,
          contextJson: "{}",
          reason: row.reason,
        }),
      ];
    }),
    ...payload.suppressedEventIds.flatMap((id) => {
      const row = rowById.get(id);
      if (!row) return [];
      return [
        suppressionHistoryRow({
          def: historyDef(row),
          notificationEventId: row.id,
          occurredAt: row.processedAt ?? new Date(),
          fingerprint: row.instanceFingerprint,
          labels: row.instanceLabels,
          silenced: false,
          inhibited: false,
          silenceId: null,
          reason: payload.reason,
        }),
      ];
    }),
  ];
  await recordAlertHistory(rows[0].sourceDefinitionId, historyRows);
}
