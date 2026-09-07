import { and, eq, inArray, isNull } from "drizzle-orm";
import { enqueueProcessAlertEvent } from "@/data/alerting/delivery/tasks";
import {
  eventSubject,
  matchingSilence,
} from "@/data/alerting/silences/matching";
import {
  loadActiveSilences,
  type SilenceRow,
} from "@/data/alerting/silences/repository";
import { db } from "@/db/client";
import { alertEvents, alertInstances } from "@/db/schema";
import {
  journalHoldRow,
  journalTerminalRow,
  recordAlertHistory,
} from "../history/clickhouse";
import { instanceKey } from "./grouping";

export function matchSilence(
  event: typeof alertEvents.$inferSelect,
  silences: SilenceRow[],
  now: Date,
) {
  return matchingSilence(eventSubject(event), silences, now);
}

/** The silence covering this event right now, loading the org's own. Use
 *  `matchSilence` where a batch is being weighed, so the scan happens once. */
export async function silenceForEvent(
  event: typeof alertEvents.$inferSelect,
  now: Date,
) {
  return matchSilence(
    event,
    await loadActiveSilences(event.organizationId, now),
    now,
  );
}

export async function eventStillFiring(event: typeof alertEvents.$inferSelect) {
  if (event.eventType === "instance_resolved") return false;
  const [row] = await db
    .select({ id: alertInstances.id })
    .from(alertInstances)
    .where(
      and(
        eq(alertInstances.organizationId, event.organizationId),
        eq(alertInstances.alertDefinitionId, event.sourceDefinitionId),
        eq(alertInstances.fingerprint, event.instanceFingerprint),
        eq(alertInstances.status, "firing"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Which of `events` have an instance that is firing right now, as a set of
 * `instanceKey`s. Loaded once per batch rather than one call per member, so a
 * flush weighing hundreds of members does not issue hundreds of single-row
 * lookups.
 *
 * The two `IN` lists are a cross product, so a firing instance that no caller
 * asked about can enter the set. That is harmless: the set is keyed on the
 * pair, so an unasked key never matches a member, and a member matches only
 * when its own definition and fingerprint really are firing.
 */
export async function loadFiringInstanceKeys(
  organizationId: string,
  events: Pick<
    typeof alertEvents.$inferSelect,
    "sourceDefinitionId" | "instanceFingerprint"
  >[],
): Promise<Set<string>> {
  if (events.length === 0) return new Set();
  const rows = await db
    .select({
      alertDefinitionId: alertInstances.alertDefinitionId,
      fingerprint: alertInstances.fingerprint,
    })
    .from(alertInstances)
    .where(
      and(
        eq(alertInstances.organizationId, organizationId),
        eq(alertInstances.status, "firing"),
        inArray(alertInstances.alertDefinitionId, [
          ...new Set(events.map((event) => event.sourceDefinitionId)),
        ]),
        inArray(alertInstances.fingerprint, [
          ...new Set(events.map((event) => event.instanceFingerprint)),
        ]),
      ),
    );
  return new Set(
    rows.map((row) =>
      instanceKey({
        sourceDefinitionId: row.alertDefinitionId,
        instanceFingerprint: row.fingerprint,
      }),
    ),
  );
}

export async function deferSuppressedEvent(
  event: typeof alertEvents.$inferSelect,
  silence: NonNullable<Awaited<ReturnType<typeof silenceForEvent>>>,
  now: Date,
) {
  const shouldRetry =
    event.eventType !== "instance_resolved" && (await eventStillFiring(event));
  const claimed = await db.transaction(async (tx) => {
    const stamped = await tx
      .update(alertEvents)
      .set({
        silenceId: silence.id,
        processedAt: shouldRetry ? null : now,
      })
      // This write is a claim, like the dispatch stamp. A concurrent pause or
      // delete cancels through `processed_at IS NULL` and projects the
      // chain's terminal. An unguarded defer would overwrite that stamp, and
      // then revive the canceled event or write a second terminal.
      //
      // Matching the value this processor read keeps exactly one owner: the
      // process path read NULL, the flush path read its own dispatch stamp,
      // and a cancel's stamp matches neither.
      .where(
        and(
          eq(alertEvents.id, event.id),
          event.processedAt === null
            ? isNull(alertEvents.processedAt)
            : eq(alertEvents.processedAt, event.processedAt),
        ),
      )
      .returning({ id: alertEvents.id });
    if (stamped.length === 0) return false;
    if (shouldRetry) {
      const runAt = silence.endsAt;
      await enqueueProcessAlertEvent(tx, event.id, {
        keySuffix: runAt.toISOString(),
        runAt,
      });
    }
    return true;
  });
  // The cancel that won the claim owns the terminal; recording one here too
  // would put two suppression rows on one chain.
  if (!claimed) return;
  // A hold is a fact; a withholding is not one yet. The event is reconsidered
  // when the silence lapses and may still go out. So the row says "held by
  // this silence", and the chain ends later with a delivery or a suppression.
  // The id derives from the event and the silence, so both defer paths and
  // their retries converge on one row per hold.
  if (shouldRetry) {
    await recordAlertHistory(
      event.sourceDefinitionId,
      [journalHoldRow(event, silence)],
      { convergesOnRetry: true },
    );
    return;
  }
  await recordAlertHistory(
    event.sourceDefinitionId,
    [journalTerminalRow(event, { silence })],
    { convergesOnRetry: true },
  );
}
