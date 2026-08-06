import { ALERTING_CANONICAL_SLO_TIERS, alertingSloTierSeverity } from "./slo";
import type {
  AlertingAlert,
  AlertingMatcher,
  AlertingRoute,
  AlertingRuleView,
  AlertingSlo,
} from "./types";

const OP_SYMBOL: Record<AlertingMatcher["op"], string> = {
  eq: "=",
  ne: "≠",
  regex: "=~",
  notregex: "!~",
};

export function alertingOpSymbol(op: AlertingMatcher["op"]): string {
  return OP_SYMBOL[op];
}

// Invalid patterns are cached as null. Configuration bounds the cache size.
const REGEX_CACHE = new Map<string, RegExp | null>();

/** Full-string regex match. Invalid patterns never match. */
function alertingRegexFullMatch(pattern: string, value: string): boolean {
  let re = REGEX_CACHE.get(pattern);
  if (re === undefined) {
    try {
      re = new RegExp(`^(?:${pattern})$`);
    } catch {
      re = null;
    }
    REGEX_CACHE.set(pattern, re);
  }
  return re?.test(value) ?? false;
}

/** Missing labels match as empty strings. */
export function alertingMatcherMatches(
  m: AlertingMatcher,
  labels: Record<string, string>,
): boolean {
  const v = labels[m.label] ?? "";
  switch (m.op) {
    case "eq":
      return v === m.value;
    case "ne":
      return v !== m.value;
    case "regex":
      return alertingRegexFullMatch(m.value, v);
    case "notregex":
      return !alertingRegexFullMatch(m.value, v);
  }
}

export function alertingRouteMatches(
  matchers: AlertingMatcher[],
  labels: Record<string, string>,
): boolean {
  return matchers.every((m) => alertingMatcherMatches(m, labels));
}

/** No matchers = matches every alert. (A `.*` regex also would, but the UI
 * only treats the explicit no-conditions form as a catch-all.) */
export function alertingIsCatchAll(matchers: AlertingMatcher[]): boolean {
  return matchers.length === 0;
}

/** Dispatcher labels, with system-owned values winning on collision. */
export function alertingSyntheticLabels(
  labels: Record<string, string>,
  opts: {
    severity: string;
    status: string;
    rule: string;
    kind?: string;
    slo?: string;
  },
): Record<string, string> {
  return {
    ...labels,
    severity: opts.severity,
    status: opts.status,
    rule: opts.rule,
    kind: opts.kind ?? "alert",
    ...(opts.slo !== undefined ? { slo: opts.slo } : {}),
  };
}

/**
 * Dispatch-time labels of a live instance. `rule` is the source uuid even for
 * SLO-sourced instances, and `slo` is stamped when SLO-sourced. Severity comes
 * from the owning rule, or for SLO instances from the `slo_tier` label's tier.
 * It is "info" when the owner is unknown.
 */
export function alertingDispatchLabels(
  alert: Pick<AlertingAlert, "labels" | "rule" | "slo">,
  rule: Pick<AlertingRuleView, "spec"> | undefined,
  slo?: Pick<AlertingSlo, "spec">,
): Record<string, string> {
  return alertingSyntheticLabels(alert.labels, {
    severity:
      rule?.spec.severity ??
      (slo
        ? alertingSloTierSeverity(ALERTING_CANONICAL_SLO_TIERS, alert.labels)
        : "info"),
    status: "firing",
    rule: alert.rule,
    ...(alert.slo !== undefined ? { slo: alert.slo } : {}),
  });
}

/** Select matching routes by priority, stopping at the first terminal route. */
export function alertingSelectRoutes(
  routes: AlertingRoute[],
  labels: Record<string, string>,
): AlertingRoute[] {
  const out: AlertingRoute[] = [];
  for (const r of [...routes].sort((a, b) => a.priority - b.priority)) {
    if (!alertingRouteMatches(r.matchers, labels)) continue;
    out.push(r);
    if (!r.continue) break;
  }
  return out;
}

/** First active silence whose matchers all match `labels`. */
export function alertingMatchingSilence<
  S extends { matchers: AlertingMatcher[]; starts_at: string; ends_at: string },
>(labels: Record<string, string>, silences: S[], now: number): S | null {
  return (
    silences.find(
      (s) =>
        new Date(s.starts_at).getTime() <= now &&
        now < new Date(s.ends_at).getTime() &&
        alertingRouteMatches(s.matchers, labels),
    ) ?? null
  );
}
