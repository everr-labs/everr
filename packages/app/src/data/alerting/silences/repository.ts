import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { alertSilences } from "@/db/schema";
import { throwAlertingPersistenceError } from "../persistence";
import { AlertingSilenceInputSchema } from "../schema";
import type { AlertingMutationScope } from "../session";
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
      author: actor.display,
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
  const rows = await db
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
  return { expired: rows.length > 0 };
}
