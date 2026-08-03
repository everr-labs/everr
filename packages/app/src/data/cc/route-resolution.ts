import { CC_CANONICAL_SLO_TIERS, ccSloTierSeverity } from "./slo";
import type { CcAlert, CcMatcher, CcRoute, CcRuleView, CcSlo } from "./types";

const OP_SYMBOL: Record<CcMatcher["op"], string> = {
  eq: "=",
  ne: "≠",
  regex: "=~",
  notregex: "!~",
};

export function ccOpSymbol(op: CcMatcher["op"]): string {
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
function ccRegexFullMatch(pattern: string, value: string): boolean {
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
export function ccMatcherMatches(
  m: CcMatcher,
  labels: Record<string, string>,
): boolean {
  const v = labels[m.label] ?? "";
  switch (m.op) {
    case "eq":
      return v === m.value;
    case "ne":
      return v !== m.value;
    case "regex":
      return ccRegexFullMatch(m.value, v);
    case "notregex":
      return !ccRegexFullMatch(m.value, v);
  }
}

export function ccRouteMatches(
  matchers: CcMatcher[],
  labels: Record<string, string>,
): boolean {
  return matchers.every((m) => ccMatcherMatches(m, labels));
}

/**
 * The label set the dispatcher matches against (dispatcher/routing.rs
 * `synthetic_labels`): instance labels plus synthetic
 * `severity`/`status`/`rule`/`kind` (and `slo` for SLO-originated events),
 * synthetics winning on collision. `kind` is "alert" for instance events.
 */
export function ccSyntheticLabels(
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
 * Dispatch-time labels of a live instance: `rule` is the source uuid even for
 * SLO-sourced instances (CC's wire convention), `slo` stamped when SLO-sourced.
 * Severity from the owning rule, or for SLO instances from the `slo_tier`
 * label's tier (domain/slo.rs `tier_severity`); "info" when the owner is unknown.
 */
export function ccDispatchLabels(
  alert: Pick<CcAlert, "labels" | "rule" | "slo">,
  rule: Pick<CcRuleView, "spec"> | undefined,
  slo?: Pick<CcSlo, "spec">,
): Record<string, string> {
  return ccSyntheticLabels(alert.labels, {
    severity:
      rule?.spec.severity ??
      (slo ? ccSloTierSeverity(CC_CANONICAL_SLO_TIERS, alert.labels) : "info"),
    status: "firing",
    rule: alert.rule,
    ...(alert.slo !== undefined ? { slo: alert.slo } : {}),
  });
}

/**
 * Mirrors CC's `select_receivers` (dispatcher/routing.rs): ascending priority,
 * stop after the first match without `continue`. Empty = falls to the firehose.
 */
export function ccSelectRoutes(
  routes: CcRoute[],
  labels: Record<string, string>,
): CcRoute[] {
  const out: CcRoute[] = [];
  for (const r of [...routes].sort((a, b) => a.priority - b.priority)) {
    if (!ccRouteMatches(r.matchers, labels)) continue;
    out.push(r);
    if (!r.continue) break;
  }
  return out;
}

/**
 * First silence active at `now` whose matchers all match `labels`, or null.
 * Mirrors CC's `matching_silence` (dispatcher/silence.rs).
 */
export function ccMatchingSilence<
  S extends { matchers: CcMatcher[]; starts_at: string; ends_at: string },
>(labels: Record<string, string>, silences: S[], now: number): S | null {
  return (
    silences.find(
      (s) =>
        new Date(s.starts_at).getTime() <= now &&
        now < new Date(s.ends_at).getTime() &&
        ccRouteMatches(s.matchers, labels),
    ) ?? null
  );
}
