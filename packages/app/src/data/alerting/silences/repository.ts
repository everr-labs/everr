import { and, desc, eq, gt, gte, lt, lte, or, sql } from "drizzle-orm";
import {
  ALERT_PROCESS_EVENT_TASK,
  PROCESS_EVENT_MAX_ATTEMPTS,
} from "@/data/alerting/delivery/tasks";
import { alertingPartitionQueue } from "@/data/alerting/scheduling/evaluation-jobs.server";
import { currentTraceLink } from "@/data/alerting/trace-link";
import {
  SILENCE_PAGE_LIMIT,
  type SilenceCut,
} from "@/data/alerting/triage/view";
import { db } from "@/db/client";
import { alertEvents, alertSilences } from "@/db/schema";
import {
  parseAlertingInput,
  throwAlertingPersistenceError,
} from "../persistence";
import { AlertingSilenceIdSchema, AlertingSilenceInputSchema } from "../schema";
import { type AlertingMutationScope, alertingActorPrincipal } from "../session";
import { ruleSubject, silenceSelects } from "./matching";

/** A stored silence, as every reader here hands it on. The API's own shape is
 *  `toSilence`; everything inside the product works from the row. */
export type SilenceRow = typeof alertSilences.$inferSelect;

/** "Not closed yet", written once. The page read filters on it, sorts by it
 *  and reports its cap against it, and a second spelling in raw SQL is one
 *  that can drift from this one. A cancelled silence has had its window
 *  collapsed by `expireSilence`, so this already excludes it. */
const stillOpen = () => gt(alertSilences.endsAt, sql`now()`);

/** One page of the org's silences, and which group its cap cut short. */
export type SilencePage = { rows: SilenceRow[]; cut: SilenceCut };

/**
 * Which silences a caller means. Five questions that differ mostly in their
 * window test, which is the one part of a silence read worth comparing:
 *
 *   listSilences         `[from, to)` half-open at both ends, the as-code API's
 *   loadSilencesInWindow `[from, to]` closed at both ends, one rule's
 *   loadSilencesForPage  `[from, to]` closed, plus everything still open
 *   loadActiveSilences   covering this instant, what delivery mutes against
 *   loadOpenSilences     not closed yet, the unstarted included
 *
 * The first three disagree about a silence that ended exactly as the window
 * opened: the API says it did not cover the window, the screens say it did.
 * Nothing turns on that yet, and it is written down here so the next reader
 * meets the two rules side by side rather than one at a time.
 */

function toSilence(row: SilenceRow) {
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

/**
 * Every silence in force this instant. Load once per batch of events being
 * weighed and pass the result on, rather than re-querying per event: a flush
 * evaluating hundreds of members must not issue hundreds of identical
 * org-wide scans.
 */
export async function loadActiveSilences(
  organizationId: string,
  now: Date,
): Promise<SilenceRow[]> {
  return db
    .select()
    .from(alertSilences)
    .where(
      and(
        eq(alertSilences.organizationId, organizationId),
        lte(alertSilences.startsAt, now),
        gt(alertSilences.endsAt, now),
      ),
    );
}

/**
 * Every silence that has not closed yet, the ones still to start included: the
 * screens list a scheduled window as well as a muting one. A cancelled silence
 * has its window collapsed by `expireSilence`, so `ends_at > now()` already
 * excludes it.
 *
 * Wider than `loadActiveSilences` by exactly the unstarted ones, which is why
 * it does not share the name.
 */
export async function loadOpenSilences(
  organizationId: string,
): Promise<SilenceRow[]> {
  return db
    .select()
    .from(alertSilences)
    .where(and(eq(alertSilences.organizationId, organizationId), stillOpen()));
}

/**
 * Silences for one rule whose window overlaps `[from, to]`, newest first.
 * Bounded by the window rather than by "active now" on purpose: the question
 * a silence list answers is usually "why did nobody hear about this", and by
 * then the silence responsible has often already expired.
 */
export async function loadSilencesInWindow(
  organizationId: string,
  ruleId: string,
  severity: string,
  from: Date,
  to: Date,
): Promise<SilenceRow[]> {
  const rows = await db
    .select()
    .from(alertSilences)
    .where(
      and(
        eq(alertSilences.organizationId, organizationId),
        lte(alertSilences.startsAt, to),
        gte(alertSilences.endsAt, from),
      ),
    )
    .orderBy(desc(alertSilences.startsAt));
  const subject = ruleSubject(ruleId, severity);
  return rows.filter((row) => silenceSelects(row.matchers, subject));
}

/**
 * What the Silences page lists: every silence still open, whatever the picked
 * range, plus the closed ones whose window overlaps it. The open ones are the
 * control surface and must not vanish because the reader is looking at last
 * week; the closed ones are evidence, and the range is what bounds evidence
 * on every other screen here.
 *
 * Open first, then newest window first. The cap is what makes the first key
 * load-bearing: ordered by window alone, a thirty-day silence started three
 * weeks ago sorts below every shorter one written since, and the one silence
 * actually muting is the row the cap drops. Sorting the open ones to the front
 * means the cap can only ever cut into one group.
 *
 * Which group that is, is decided here and handed on rather than inferred by
 * the reader: the cap and the order are both written in this function, and a
 * screen that re-derived the answer from the rows would be reading a contract
 * it cannot see. `cut` names the group whose count is a floor rather than an
 * answer, and is `null` when the read fit.
 */
export async function loadSilencesForPage(
  organizationId: string,
  from: Date,
  to: Date,
): Promise<SilencePage> {
  const rows = await db
    .select({
      silence: alertSilences,
      // Decided by the database, in the same clock and the same terms as the
      // sort, so the row the cap stopped at cannot be filed under one group
      // here and the other one there.
      open: stillOpen(),
    })
    .from(alertSilences)
    .where(
      and(
        eq(alertSilences.organizationId, organizationId),
        or(
          stillOpen(),
          and(lte(alertSilences.startsAt, to), gte(alertSilences.endsAt, from)),
        ),
      ),
    )
    .orderBy(desc(stillOpen()), desc(alertSilences.startsAt))
    .limit(SILENCE_PAGE_LIMIT);
  const last = rows.at(-1);
  return {
    rows: rows.map((row) => row.silence),
    // The open rows lead, so a full page was cut off inside whichever group
    // its last row belongs to: reaching a closed row at all means every open
    // one is already here.
    cut:
      rows.length < SILENCE_PAGE_LIMIT || !last
        ? null
        : last.open
          ? "open"
          : "history",
  };
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
