import { and, eq, isNull, ne } from "drizzle-orm";
import type { Transaction } from "@/db/client";
import {
  type alertDefinitions,
  alertEvents,
  alertInstances,
} from "@/db/schema";
import { uuidv7 } from "@/server/alerts/history/ids";
import { ALERT_PROJECT_LIFECYCLE_TASK } from "@/server/alerts/history/tasks";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";

type RuleRow = typeof alertDefinitions.$inferSelect;
type InstanceRow = typeof alertInstances.$inferSelect;
type LifecycleReason = "rule_paused" | "rule_deleted";

/**
 * The journal terminal for an instance a mutation ends. Born processed and
 * state kind: it exists only to be projected, and the delivery pipeline's
 * notifying-kind boundary can never select it.
 */
export function instanceClosedJournalRow(
  def: RuleRow,
  instance: Pick<InstanceRow, "fingerprint" | "labels" | "episodeId">,
  reason: LifecycleReason,
  at: Date,
): typeof alertEvents.$inferInsert {
  return {
    id: uuidv7(at),
    organizationId: def.organizationId,
    repoid: def.repoid,
    previewId: def.previewId,
    sourceDefinitionId: def.id,
    slug: `${def.project}/${def.slug}`,
    eventType: "instance_closed",
    kind: "state",
    episodeId: instance.episodeId,
    reason,
    instanceFingerprint: instance.fingerprint,
    instanceLabels: instance.labels,
    severity: def.spec.severity,
    suppressed: def.spec.suppressed || def.previewId !== null,
    occurredAt: at,
    processedAt: at,
  };
}

/**
 * Close a rule's open instances in the mutation's own transaction: journal one
 * `instance_closed` terminal per open instance, cancel every not-yet-processed
 * notifying event so nothing sends after the mutation commits, and enqueue the
 * projection of both. The instance reset (pause) or cascade (delete) happens
 * at the call site, after this has read the open set.
 */
export async function closeRuleLifecycle(
  tx: Transaction,
  def: RuleRow,
  reason: LifecycleReason,
  at: Date,
): Promise<{ closedEventIds: string[]; suppressedEventIds: string[] }> {
  const openInstances = await tx
    .select()
    .from(alertInstances)
    .where(
      and(
        eq(alertInstances.alertDefinitionId, def.id),
        ne(alertInstances.status, "inactive"),
      ),
    );
  const closedRows = openInstances.map((instance) =>
    instanceClosedJournalRow(def, instance, reason, at),
  );
  if (closedRows.length > 0) {
    await tx.insert(alertEvents).values(closedRows);
  }
  const canceled = await tx
    .update(alertEvents)
    .set({ processedAt: at })
    .where(
      and(
        eq(alertEvents.organizationId, def.organizationId),
        eq(alertEvents.sourceDefinitionId, def.id),
        eq(alertEvents.kind, "notifying"),
        isNull(alertEvents.processedAt),
      ),
    )
    .returning({ id: alertEvents.id });
  const closedEventIds = closedRows.flatMap((row) => (row.id ? [row.id] : []));
  const suppressedEventIds = canceled.map((row) => row.id);
  if (closedEventIds.length > 0 || suppressedEventIds.length > 0) {
    await addWorkerJobInTransaction(
      tx,
      ALERT_PROJECT_LIFECYCLE_TASK,
      { closedEventIds, suppressedEventIds, reason },
      { maxAttempts: 5 },
    );
  }
  return { closedEventIds, suppressedEventIds };
}
