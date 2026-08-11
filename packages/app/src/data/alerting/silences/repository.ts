import { and, desc, eq, gt, sql } from "drizzle-orm";
import {
  ALERT_PROCESS_EVENT_TASK,
  PROCESS_EVENT_MAX_ATTEMPTS,
} from "@/data/alerting/delivery/tasks";
import { alertingPartitionQueue } from "@/data/alerting/scheduling/evaluation-jobs.server";
import { db } from "@/db/client";
import { alertEvents, alertSilences } from "@/db/schema";
import { throwAlertingPersistenceError } from "../persistence";
import { AlertingSilenceInputSchema } from "../schema";
import { type AlertingMutationScope, alertingActorPrincipal } from "../session";
import type { AlertingSilenceInput } from "../types";

function toSilence(row: typeof alertSilences.$inferSelect) {
  return {
    id: row.id,
    tenant: row.organizationId,
    matchers: row.matchers,
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt.toISOString(),
    comment: row.comment,
    author: row.author,
    created_at: row.createdAt.toISOString(),
    canceled_at: row.canceledAt?.toISOString() ?? null,
  };
}

export async function listSilences(organizationId: string) {
  const rows = await db
    .select()
    .from(alertSilences)
    .where(eq(alertSilences.organizationId, organizationId))
    .orderBy(desc(alertSilences.createdAt));
  return rows.map(toSilence);
}

export async function createSilence(
  { organizationId, actor }: AlertingMutationScope,
  rawInput: AlertingSilenceInput,
) {
  const input = AlertingSilenceInputSchema.parse(rawInput);
  const startsAt = new Date(input.starts_at);
  const endsAt = new Date(input.ends_at);
  if (!(endsAt > startsAt)) {
    throwAlertingPersistenceError(
      422,
      "validation",
      "silence ends_at must be after starts_at",
    );
  }
  const [row] = await db
    .insert(alertSilences)
    .values({
      organizationId,
      startsAt,
      endsAt,
      comment: input.comment ?? "",
      // Server-derived: the caller cannot name somebody else as the author.
      // The display renders; the principal is the identity a later rename
      // cannot rewrite, and what ticket 17's audit reads.
      author: actor.display,
      authorPrincipal: alertingActorPrincipal(actor),
      matchers: input.matchers,
    })
    .returning();
  return toSilence(row);
}

/**
 * Cancel a silence by closing its window, leaving the row in place.
 *
 * Alert history in ClickHouse records the `silence_id` that withheld a
 * notification. Deleting the row would strand every one of those references,
 * so the record of why nobody was paged has to outlive the silence. The
 * periodic cleanup is what eventually deletes, and only long after the window
 * has closed.
 *
 * `GREATEST` handles a silence that has not started yet: clamping `ends_at` to
 * `now` would put it before `starts_at`, so it collapses to `starts_at` and
 * the window ends up empty instead of inverted.
 */
export async function expireSilence(
  { organizationId }: AlertingMutationScope,
  id: string,
) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(alertSilences)
      .set({
        endsAt: sql`LEAST(${alertSilences.endsAt}, GREATEST(${alertSilences.startsAt}, now()))`,
        canceledAt: sql`now()`,
      })
      .where(
        and(
          eq(alertSilences.organizationId, organizationId),
          eq(alertSilences.id, id),
          // An already-closed window was not cancelled by anyone, and stamping
          // canceled_at on it would misattribute a natural expiry.
          gt(alertSilences.endsAt, sql`now()`),
        ),
      )
      .returning({ id: alertSilences.id });
    if (rows.length === 0) return { expired: false };
    // A deferred event wakes at the silence's original ends_at, which the
    // cancel just collapsed; without a release it stays held for the full
    // window. One set-based statement enqueues every held event in the same
    // transaction, and one queue per canceled silence serializes the
    // released re-checks instead of running them all at once. The re-run
    // re-checks every hold, so another matching silence re-defers instead of
    // paging; the stale wake at the old ends_at then either finds the event
    // processed and no-ops, or harmlessly re-runs the idempotent decision.
    const releaseQueue = alertingPartitionQueue("alert", id);
    await tx.execute(sql`
      SELECT graphile_worker.add_job(
        ${ALERT_PROCESS_EVENT_TASK},
        json_build_object('eventId', ${alertEvents.id}),
        queue_name := ${releaseQueue},
        run_at := now(),
        max_attempts := ${PROCESS_EVENT_MAX_ATTEMPTS},
        job_key := ${ALERT_PROCESS_EVENT_TASK} || ':' || ${alertEvents.id}::text || ':release',
        job_key_mode := 'replace'
      )
      FROM ${alertEvents}
      WHERE ${alertEvents.organizationId} = ${organizationId}
        AND ${alertEvents.silenceId} = ${id}
        AND ${alertEvents.processedAt} IS NULL
    `);
    return { expired: true };
  });
}
