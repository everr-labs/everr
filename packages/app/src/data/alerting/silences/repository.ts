import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import {
  ALERT_PROCESS_EVENT_TASK,
  PROCESS_EVENT_MAX_ATTEMPTS,
} from "@/data/alerting/delivery/tasks";
import { alertingPartitionQueue } from "@/data/alerting/scheduling/evaluation-jobs.server";
import { currentTraceLink } from "@/data/alerting/trace-link";
import { db } from "@/db/client";
import { alertEvents, alertSilences } from "@/db/schema";
import {
  parseAlertingInput,
  throwAlertingPersistenceError,
} from "../persistence";
import { AlertingSilenceIdSchema, AlertingSilenceInputSchema } from "../schema";
import { type AlertingMutationScope, alertingActorPrincipal } from "../session";

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

/**
 * One page of the org's silences, newest first.
 *
 * The page is not optional. Retention keeps a closed silence for 90 days, so
 * the table grows with how much an org pages, and there is no caller for whom
 * reading all of it is the right thing to do.
 *
 * `from` and `to` select the silences whose own window overlaps the one asked
 * about, which is the question somebody has when a page did not arrive: what
 * was silencing at the time. The comparison is half-open at both ends, so a
 * silence that ended exactly when the window opened did not cover it. Each
 * bound stands alone: `from` on its own means "had not closed yet by then",
 * and `from` equal to `to` means "covering that instant".
 */
export async function listSilences(
  organizationId: string,
  query: { limit: number; offset: number; from?: Date; to?: Date },
) {
  const rows = await db
    .select()
    .from(alertSilences)
    .where(
      and(
        eq(alertSilences.organizationId, organizationId),
        query.to ? lt(alertSilences.startsAt, query.to) : undefined,
        query.from ? gt(alertSilences.endsAt, query.from) : undefined,
      ),
    )
    .orderBy(desc(alertSilences.createdAt))
    .limit(query.limit)
    .offset(query.offset);
  return rows.map(toSilence);
}

export async function createSilence(
  { organizationId, actor }: AlertingMutationScope,
  rawInput: unknown,
) {
  const input = parseAlertingInput(AlertingSilenceInputSchema, rawInput);
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
      // cannot rewrite, and what an audit trail reads.
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
  rawId: string,
) {
  const id = parseAlertingInput(AlertingSilenceIdSchema, rawId);
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
    // cancel just collapsed. Without a release it stays held for the full
    // window. One set-based statement enqueues every held event in the same
    // transaction, and one queue per canceled silence serializes the released
    // re-checks.
    //
    // The re-run re-checks every hold, so another matching silence re-defers
    // instead of paging. The stale wake at the old ends_at then finds the
    // event processed and does nothing, or re-runs the same decision.
    const releaseQueue = alertingPartitionQueue("alert", id);
    // One statement enqueues every held event, so the trace link is the same
    // for all of them: the request that canceled the silence. Absent when the
    // cancel came from outside a span, which the consumer treats as no link.
    const { traceparent } = currentTraceLink();
    await tx.execute(sql`
      SELECT graphile_worker.add_job(
        ${ALERT_PROCESS_EVENT_TASK},
        json_build_object(
          'eventId', ${alertEvents.id},
          'traceparent', ${traceparent ?? null}::text
        ),
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
