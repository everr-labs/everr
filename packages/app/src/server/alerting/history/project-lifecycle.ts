import { inArray } from "drizzle-orm";
import { AlertLifecycleProjectionPayloadSchema } from "#app/data/alerting/history/tasks.ts";
import { db } from "#app/db/client.ts";
import { alertEvents } from "#app/db/schema/index.ts";
import {
  historyDefFromJournalRow,
  instanceHistoryRow,
  journalTerminalRow,
  recordAlertHistoryStrict,
  ZERO_UUID,
} from "./clickhouse";

/**
 * Project the lifecycle terminals a pause or delete journaled. Runs after the
 * mutation's commit; the journal rows are self-sufficient, so a definition
 * that is already gone (delete) needs no lookup.
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

  const historyRows = [
    ...payload.closedEventIds.flatMap((id) => {
      const row = rowById.get(id);
      if (!row) return [];
      return [
        instanceHistoryRow({
          def: historyDefFromJournalRow(row),
          eventId: row.id,
          eventType: "instance_closed" as const,
          occurredAt: row.occurredAt,
          episodeId: row.episodeId ?? ZERO_UUID,
          fingerprint: row.instanceFingerprint,
          labels: row.instanceLabels,
          evidence: {},
          evidenceTruncated: false,
          contextJson: "{}",
          reason: row.reason || undefined,
        }),
      ];
    }),
    ...payload.suppressedEventIds.flatMap((id) => {
      const row = rowById.get(id);
      if (!row) return [];
      return [journalTerminalRow(row, { reason: payload.reason })];
    }),
  ];
  // Strict on purpose: this task's only job is the insert, and Graphile's
  // retries are the recovery mechanism. Swallowing here would report success
  // while the chain's terminals are lost.
  await recordAlertHistoryStrict(historyRows);
}
