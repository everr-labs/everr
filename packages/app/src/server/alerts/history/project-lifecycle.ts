import { inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { alertEvents } from "@/db/schema";
import {
  historyDefFromJournalRow,
  instanceHistoryRow,
  recordAlertHistoryStrict,
  suppressionHistoryRow,
  ZERO_UUID,
} from "./clickhouse";
import { AlertLifecycleProjectionPayloadSchema } from "./tasks";

// suppressedEventIds only ever names rows a claiming update already stamped:
// closeRuleLifecycle sets processedAt on the events it cancels in the same
// transaction that enqueues this task, and an orphaned membership belongs to
// an event a group dispatch already claimed earlier. A null here means that
// invariant broke, and a minted `new Date()` would silently give a Graphile
// retry a different event_time than the first attempt on the same
// deterministic event_id, which the design doc requires to stay stable.
function requireProcessedAt(row: {
  id: string;
  processedAt: Date | null;
}): Date {
  if (row.processedAt === null) {
    throw new Error(
      `alert_events row ${row.id} has no processedAt; the lifecycle projection` +
        " only reads rows a claiming update already stamped",
    );
  }
  return row.processedAt;
}

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
      return [
        suppressionHistoryRow({
          def: historyDefFromJournalRow(row),
          notificationEventId: row.id,
          occurredAt: requireProcessedAt(row),
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
  // Strict on purpose: this task's only job is the insert, and Graphile's
  // retries are the recovery mechanism. Swallowing here would report success
  // while the chain's terminals are lost.
  await recordAlertHistoryStrict(historyRows);
}
