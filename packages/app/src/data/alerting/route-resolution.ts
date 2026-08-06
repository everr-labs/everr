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

// Mirrors matching.rs REGEX_CACHE (null = known-invalid, never matches).
// Patterns come from routes/silences/inhibitions, so the distinct count is
// bounded by configuration size; the map is intentionally unbounded.
const REGEX_CACHE = new Map<string, RegExp | null>();

/**
 * Anchored match mirroring matching.rs `regex_full_match`: compiled as
 * `^(?:pattern)$`; an invalid pattern never matches.
 */
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

/**
 * Mirrors matching.rs `matcher_matches`. A missing label is the empty string
 * (Alertmanager-like): `severity != critical` is true when `severity` is absent.
 */
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

/**
 * The label set the dispatcher matches against (dispatcher/routing.rs
 * `synthetic_labels`): instance labels plus synthetic
 * `severity`/`status`/`rule`/`kind` (and `slo` for SLO-originated events),
 * synthetics winning on collision. `kind` is "alert" for instance events.
 */
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

/**
 * Mirrors alerting engine's `select_receivers` (dispatcher/routing.rs): ascending priority,
 * stop after the first match without `continue`.
 */
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

/**
 * First silence active at `now` whose matchers all match `labels`, or null.
 * Mirrors alerting engine's `matching_silence` (dispatcher/silence.rs).
 */
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
