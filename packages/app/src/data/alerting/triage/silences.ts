/**
 * Silences as the screens read them: which one is in force for a rule, what
 * it looks like on a row, and the record the two lists print.
 *
 * Which silences to fetch is a separate question, and every version of it
 * lives together in the silences repository.
 */
import {
  ruleSubject,
  silenceIsInForce,
  silenceSelects,
} from "@/data/alerting/silences/matching";
import type { SilenceRow } from "@/data/alerting/silences/repository";
import type { AlertingMatcher } from "@/data/alerting/types";
import { formatElapsed, silenceImpact } from "./format";
import type { AlertSilenceRecord, AlertSilenceView } from "./view";

/** What a silence did to delivery: notifications it is still sitting on, and
 *  ones it dropped for good. */
export type SilenceImpactCounts = { held: number; dropped: number };

/** The `project/slug` for a definition's row id, or `null` where the rule is
 *  gone: retention keeps a silence for 90 days, and the rule it named can be
 *  deleted inside that window. */
export type RulePathFor = (ruleId: string) => string | null;

/** What a silence did to delivery when history has no row for it. */
const NO_IMPACT: SilenceImpactCounts = { held: 0, dropped: 0 };

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

/** Everything the app knows about a silence, for the two screens that list
 *  them. */
export function silenceRecord(
  row: SilenceRow,
  now: Date,
  counts: SilenceImpactCounts,
  rulePath: RulePathFor,
): AlertSilenceRecord {
  const rules = row.matchers.filter((m) => m.label === "rule" && m.op === "eq");
  return {
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    state: silenceState(row, now),
    matchers: formatMatchers(row.matchers),
    // A silence written outside these screens can name a rule twice, or with
    // `!=`, and "silence this rule again" has no one rule to mean then.
    //
    // The matcher holds a row id, which names nothing a reader knows. It is
    // resolved here, once, so every screen prints and links the same path and
    // none of them has to know what the matcher actually stores.
    rule: rules.length === 1 ? rulePath(rules[0].value) : null,
    scope: formatMatchers(row.matchers.filter((m) => m.label !== "rule")),
    canceledAt: row.canceledAt?.toISOString() ?? null,
    impact: silenceImpact(counts),
    comment: row.comment,
    author: row.author,
  };
}

/** The records for a list of rows, each with whatever history counted for it.
 *  One place decides that a silence history has no row for withheld nothing,
 *  so the two screens that list silences cannot answer that differently. */
export function silenceRecords(
  rows: SilenceRow[],
  now: Date,
  impacts: Map<string, SilenceImpactCounts>,
  rulePath: RulePathFor,
): AlertSilenceRecord[] {
  return rows.map((row) =>
    silenceRecord(row, now, impacts.get(row.id) ?? NO_IMPACT, rulePath),
  );
}
