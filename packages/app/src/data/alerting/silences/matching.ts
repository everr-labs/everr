/**
 * What a silence applies to, for both sides that have to decide it: delivery,
 * which asks per event, and the alerting screens, which ask per rule.
 *
 * The label set a silence is tested against is built by the two functions here
 * and nowhere else. Each side used to assemble its own, and the two spelled the
 * rule differently, so a silence written from the screen matched nothing the
 * pipeline ever evaluated: the board said "Silenced" and the notification went
 * out anyway.
 *
 * The label they have to agree on is `rule`, and its value is the definition's
 * row id: the only name for a rule that survives being renamed, and the only
 * one that tells a live rule apart from a preview of it, which share
 * `project/slug`. A person never types it and never reads it. The dialog
 * resolves the path they picked, and the screens resolve it back to a name
 * before printing.
 */
import type { alertEvents } from "@/db/schema";
import type { AlertingMatcher } from "../types";

/** What delivery holds about the event being decided on. */
type EventSubject = Pick<
  typeof alertEvents.$inferSelect,
  "instanceLabels" | "severity" | "eventType" | "sourceDefinitionId"
>;

/**
 * The labels one silence decision is taken against.
 *
 * `eventSubject` and `ruleSubject` below build every one of these, and no
 * caller names the rule itself: that, and not the type, is what keeps the two
 * askers spelling it the same way.
 */
export type SilenceSubject = Record<string, string>;

/** A silence's window. Half-open: it covers its start instant and not its
 *  end instant. */
export type SilenceWindow = { startsAt: Date; endsAt: Date };

type SilenceCandidate = SilenceWindow & { matchers: AlertingMatcher[] };

/**
 * Delivery's subject: the instance's own labels with the synthetics laid over
 * them, so a user label named `severity` cannot dress an instance up as
 * something it is not.
 */
export function eventSubject(event: EventSubject): SilenceSubject {
  return {
    ...event.instanceLabels,
    rule: event.sourceDefinitionId,
    severity: event.severity,
    status: event.eventType === "instance_resolved" ? "resolved" : "firing",
  };
}

/**
 * The screens' subject: a rule carries no instance labels of its own, so a
 * silence scoped to one instance does not select the rule, and a rule reads as
 * silenced only when something mutes all of it. `status` is `firing` because
 * the question a screen asks is whether this rule's pages are being held.
 */
export function ruleSubject(ruleId: string, severity: string): SilenceSubject {
  return { rule: ruleId, severity, status: "firing" };
}

/** Missing labels match as empty strings. Matching is exact only: a value
 *  that reads as a pattern is compared literally. */
function matcherSelects(
  matcher: AlertingMatcher,
  subject: SilenceSubject,
): boolean {
  const value = subject[matcher.label] ?? "";
  switch (matcher.op) {
    case "eq":
      return value === matcher.value;
    case "ne":
      return value !== matcher.value;
  }
}

/** Every matcher has to select the subject. A silence with none selects
 *  everything, which is what an org-wide mute is. */
export function silenceSelects(
  matchers: AlertingMatcher[],
  subject: SilenceSubject,
): boolean {
  return matchers.every((m) => matcherSelects(m, subject));
}

/** Whether the silence's window covers `now`. Distinct from the screens'
 *  `isOpen`, which counts a window that has not started yet: this one is
 *  about muting, and a silence that has not started mutes nothing. */
export function silenceIsInForce(window: SilenceWindow, now: Date): boolean {
  return window.startsAt <= now && now < window.endsAt;
}

/** The first silence in force whose matchers all select the subject. */
export function matchingSilence<S extends SilenceCandidate>(
  subject: SilenceSubject,
  silences: S[],
  now: Date,
): S | null {
  return (
    silences.find(
      (s) => silenceIsInForce(s, now) && silenceSelects(s.matchers, subject),
    ) ?? null
  );
}
