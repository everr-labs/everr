/**
 * Silences as the triage screen reads them: which one is in force for a rule,
 * what it looks like on a row, and the record the detail lists.
 */
import { and, desc, eq, gt, gte, lte, or, sql } from "drizzle-orm";
import {
  ruleSubject,
  silenceIsInForce,
  silenceSelects,
} from "@/data/alerting/silences/matching";
import type { AlertingMatcher } from "@/data/alerting/types";
import { db } from "@/db/client";
import { alertSilences } from "@/db/schema";
import { formatElapsed, silenceImpact } from "./format";
import type {
  AlertSilencePageRow,
  AlertSilenceRecord,
  AlertSilenceView,
} from "./view";

export type SilenceRow = typeof alertSilences.$inferSelect;

/** What a silence did to delivery: notifications it is still sitting on, and
 *  ones it dropped for good. */
export type SilenceImpactCounts = { held: number; dropped: number };

/**
 * Every silence that has not closed yet, the ones still to start included: the
 * screens list a scheduled window as well as a muting one. A cancelled silence
 * has its window collapsed by `expireSilence`, so `ends_at > now()` already
 * excludes it.
 *
 * Not `loadActiveSilences`: delivery has a loader by that name and it means
 * the narrower thing, the silences in force this instant.
 */
export async function loadOpenSilences(
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

/**
 * What the Silences page lists: every silence still open, whatever the picked
 * range, plus the closed ones whose window overlaps it. The open ones are the
 * control surface and must not vanish because the reader is looking at last
 * week; the closed ones are evidence, and the range is what bounds evidence
 * on every other screen here.
 *
 * Newest window first. The page regroups by state and re-sorts the scheduled
 * ones as a queue, so this order only settles ties within a group.
 */
export async function loadSilencesForPage(
  organizationId: string,
  from: Date,
  to: Date,
): Promise<SilenceRow[]> {
  return db
    .select()
    .from(alertSilences)
    .where(
      and(
        eq(alertSilences.organizationId, organizationId),
        or(
          gt(alertSilences.endsAt, sql`now()`),
          and(lte(alertSilences.startsAt, to), gte(alertSilences.endsAt, from)),
        ),
      ),
    )
    .orderBy(desc(alertSilences.startsAt))
    .limit(PAGE_LIMIT);
}

/** Retention keeps closed silences for 90 days, and an Organization that
 *  writes more than this many in a range that wide has a different problem
 *  than a list that stops. */
const PAGE_LIMIT = 500;

function isWholeRuleSilence(matchers: AlertingMatcher[]): boolean {
  return matchers.every((m) => m.label === "rule");
}

/**
 * The silence in force for a rule right now, preferring one that covers the
 * whole rule: a rule muted outright is a different fact from one instance
 * being muted, and the row says so differently.
 *
 * The window is checked here rather than assumed of the caller's list. It used
 * to test only that the silence had started, which was right for the rows
 * `loadOpenSilences` returns and wrong for any other list: handed the window
 * loader's rows, it called a silence that expired last Tuesday the one in
 * force.
 */
export function silenceFor(
  ruleId: string,
  severity: string,
  silences: SilenceRow[],
  now: Date,
): SilenceRow | null {
  const subject = ruleSubject(ruleId, severity);
  const matching = silences.filter(
    (s) => silenceIsInForce(s, now) && silenceSelects(s.matchers, subject),
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

function silenceState(row: SilenceRow, now: Date): AlertSilenceRecord["state"] {
  return row.canceledAt !== null
    ? "cancelled"
    : row.startsAt > now
      ? "scheduled"
      : row.endsAt <= now
        ? "expired"
        : "active";
}

const formatMatchers = (matchers: AlertingMatcher[]): string =>
  matchers
    .map((m) => `${m.label}${m.op === "ne" ? "!=" : "="}${m.value}`)
    .join(" ");

/** Everything the app knows about a silence, for the detail's own list. */
export function silenceRecord(
  row: SilenceRow,
  now: Date,
  counts: SilenceImpactCounts,
): AlertSilenceRecord {
  // The rule matcher is on every silence this screen writes and is what
  // selected the row in the first place, so listing it back says nothing.
  const scoped = row.matchers.filter((m) => m.label !== "rule");
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    state: silenceState(row, now),
    matchers: formatMatchers(scoped),
    wholeRule: scoped.length === 0,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    impact: silenceImpact(counts),
    comment: row.comment,
    author: row.author,
  };
}

/** The same silence as the Silences page lists it, rule included. */
export function silencePageRow(
  row: SilenceRow,
  now: Date,
  counts: SilenceImpactCounts,
): AlertSilencePageRow {
  const rules = row.matchers.filter(
    (m) => m.label === RULE_LABEL && m.op === "eq",
  );
  const scoped = row.matchers.filter((m) => m.label !== RULE_LABEL);
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    state: silenceState(row, now),
    canceledAt: row.canceledAt?.toISOString() ?? null,
    matchers: formatMatchers(row.matchers),
    // A silence written outside this screen can name a rule twice, or with
    // `!=`, and "silence this rule again" has no one rule to mean then.
    rule: rules.length === 1 ? rules[0].value : null,
    scope: formatMatchers(scoped),
    impact: silenceImpact(counts),
    comment: row.comment,
    author: row.author,
  };
}
