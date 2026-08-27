/**
 * Silences as the triage screen reads them: which one is in force for a rule,
 * what it looks like on a row, and the record the detail lists.
 */
import { and, desc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { ruleSubject, silenceSelects } from "@/data/alerting/silences/matching";
import type { AlertingMatcher } from "@/data/alerting/types";
import { db } from "@/db/client";
import { alertSilences } from "@/db/schema";
import { formatElapsed, silenceImpact } from "./format";
import type { AlertSilenceRecord, AlertSilenceView } from "./view";

export type SilenceRow = typeof alertSilences.$inferSelect;

/** What a silence did to delivery: notifications it is still sitting on, and
 *  ones it dropped for good. */
export type SilenceImpactCounts = { held: number; dropped: number };

/** Silences whose window covers now. A cancelled silence has its window
 *  collapsed by `expireSilence`, so `ends_at > now()` already excludes it. */
export async function loadActiveSilences(
  organizationId: string,
): Promise<SilenceRow[]> {
  return db
    .select()
    .from(alertSilences)
    .where(
      and(
        eq(alertSilences.organizationId, organizationId),
        gt(alertSilences.endsAt, sql`now()`),
      ),
    );
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

function isWholeRuleSilence(matchers: AlertingMatcher[]): boolean {
  return matchers.every((m) => m.label === "rule");
}

/**
 * The silence in force for a rule right now, preferring one that covers the
 * whole rule: a rule muted outright is a different fact from one instance
 * being muted, and the row says so differently.
 */
export function silenceFor(
  ruleId: string,
  severity: string,
  silences: SilenceRow[],
  now: Date,
): SilenceRow | null {
  const subject = ruleSubject(ruleId, severity);
  const matching = silences.filter(
    (s) => s.startsAt <= now && silenceSelects(s.matchers, subject),
  );
  return (
    matching.find((s) => isWholeRuleSilence(s.matchers)) ?? matching[0] ?? null
  );
}

export function silenceView(
  row: SilenceRow,
  now: Date,
  held: number,
): AlertSilenceView {
  return {
    id: row.id,
    wholeRule: isWholeRuleSilence(row.matchers),
    expiresIn: formatElapsed(row.endsAt.getTime() - now.getTime()),
    suppressed: held,
  };
}

/** Everything the app knows about a silence, for the detail's own list. */
export function silenceRecord(
  row: SilenceRow,
  now: Date,
  counts: SilenceImpactCounts,
): AlertSilenceRecord {
  const state: AlertSilenceRecord["state"] =
    row.canceledAt !== null
      ? "cancelled"
      : row.startsAt > now
        ? "scheduled"
        : row.endsAt <= now
          ? "expired"
          : "active";
  // The rule matcher is on every silence this screen writes and is what
  // selected the row in the first place, so listing it back says nothing.
  const scoped = row.matchers.filter((m) => m.label !== "rule");
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    state,
    matchers: scoped
      .map((m) => `${m.label}${m.op === "ne" ? "!=" : "="}${m.value}`)
      .join(" "),
    wholeRule: scoped.length === 0,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    impact: silenceImpact(counts),
    comment: row.comment,
    author: row.author,
  };
}
