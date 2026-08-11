import {
  and,
  eq,
  isNotNull,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias, QueryBuilder } from "drizzle-orm/pg-core";
import { uuidv7 } from "@/data/alerting/history/ids";
import { ALERT_PROJECT_LIFECYCLE_TASK } from "@/data/alerting/history/tasks";
import type { AlertingLifecycleReason } from "@/data/alerting/vocabulary";
import type { Transaction } from "@/db/client";
import {
  type alertDefinitions,
  alertEvents,
  alertInstances,
  alertNotificationGroupEvents,
  alertNotificationGroups,
} from "@/db/schema";
import { addWorkerJobInTransaction } from "@/server/worker/jobs";

type RuleRow = typeof alertDefinitions.$inferSelect;
type InstanceRow = typeof alertInstances.$inferSelect;
type LifecycleReason = Extract<
  AlertingLifecycleReason,
  "labels_changed" | "rule_paused" | "rule_deleted"
>;

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
): typeof alertEvents.$inferInsert & { id: string } {
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
    suppressed: def.previewId !== null,
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
    .where(cancelableNotifyingEventsFilter(def))
    .returning({ id: alertEvents.id });
  // A delete's cascade takes the rule's direct groups and their memberships
  // with it, so the flush that would have written those chains' terminals can
  // never run (it finds no group and returns). Claim them here instead, before
  // the cascade fires. Pause never needs this: its groups survive, and the
  // flush itself drops the dead members and writes their terminals.
  const orphaned =
    reason === "rule_deleted"
      ? await tx
          .selectDistinct({ eventId: alertNotificationGroupEvents.eventId })
          .from(alertNotificationGroupEvents)
          .innerJoin(
            alertNotificationGroups,
            and(
              eq(
                alertNotificationGroups.organizationId,
                alertNotificationGroupEvents.organizationId,
              ),
              eq(
                alertNotificationGroups.id,
                alertNotificationGroupEvents.groupId,
              ),
            ),
          )
          .where(orphanedDirectChainsFilter(def))
      : [];
  const closedEventIds = closedRows.map((row) => row.id);
  // Disjoint sets: a cancel takes unprocessed events, an orphaned membership
  // belongs to an event the dispatch already processed into its group.
  const suppressedEventIds = [
    ...canceled.map((row) => row.id),
    ...orphaned.map((row) => row.eventId),
  ];
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

/**
 * What a mutation may cancel: the rule's own not-yet-processed notifying
 * events, nothing else. Scoped by organization and definition so no other
 * tenant's or rule's in-flight work is touched, to `kind = 'notifying'` so
 * born-processed state rows stay out, and to `processed_at IS NULL` so an
 * event a worker already claimed keeps exactly one owner.
 */
export function cancelableNotifyingEventsFilter(
  def: Pick<RuleRow, "id" | "organizationId">,
) {
  return and(
    eq(alertEvents.organizationId, def.organizationId),
    eq(alertEvents.sourceDefinitionId, def.id),
    eq(alertEvents.kind, "notifying"),
    isNull(alertEvents.processedAt),
  );
}

/**
 * The chains a delete's cascade would orphan: unflushed memberships in this
 * rule's own direct groups, for events with no other route to an outcome. A
 * membership that flushed anywhere means the chain already notified, and a
 * membership in any group that survives the cascade (receiver-routed, or
 * another rule's direct) means that group's flush owns the terminal; either
 * one excludes the event.
 */
export function orphanedDirectChainsFilter(
  def: Pick<RuleRow, "id" | "organizationId">,
) {
  const otherMembership = alias(
    alertNotificationGroupEvents,
    "other_membership",
  );
  const otherGroup = alias(alertNotificationGroups, "other_group");
  return and(
    eq(alertNotificationGroups.organizationId, def.organizationId),
    eq(alertNotificationGroups.directAlertDefinitionId, def.id),
    isNull(alertNotificationGroupEvents.flushedAt),
    notExists(
      new QueryBuilder()
        .select({ one: sql`1` })
        .from(otherMembership)
        .innerJoin(
          otherGroup,
          and(
            eq(otherGroup.organizationId, otherMembership.organizationId),
            eq(otherGroup.id, otherMembership.groupId),
          ),
        )
        .where(
          and(
            eq(otherMembership.eventId, alertNotificationGroupEvents.eventId),
            or(
              isNotNull(otherMembership.flushedAt),
              sql`${otherGroup.directAlertDefinitionId} IS DISTINCT FROM ${def.id}`,
            ),
          ),
        ),
    ),
  );
}
