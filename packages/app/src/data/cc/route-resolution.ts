// packages/app/src/data/cc/route-resolution.ts
// Pure, mirrors CC's matcher semantics. Used to show "where does this alert go"
// and to drive the routing pipeline preview. First match by ascending priority.
import { ccSloTierSeverity, ccSloTiers } from "./slo";
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

// Module-level cache of compiled anchored patterns, keyed by the raw pattern
// string (null = known-invalid, never matches). Mirrors matching.rs's
// REGEX_CACHE: patterns come from routes/silences/inhibitions, so the distinct
// count is bounded by configuration size and the map is intentionally unbounded.
const REGEX_CACHE = new Map<string, RegExp | null>();

/**
 * Anchored (full-string) regex match, mirroring matching.rs `regex_full_match`:
 * the pattern is compiled as `^(?:pattern)$`, and an invalid pattern never
 * matches. Each distinct pattern is compiled at most once.
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
 * Match one matcher against a label set, mirroring matching.rs
 * `matcher_matches`. A missing label is the empty string (Alertmanager-like):
 * `severity != critical` is true when `severity` is absent.
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
 * The label set CC's dispatcher actually matches routes/silences/inhibitions
 * against (dispatcher/routing.rs `synthetic_labels`): the instance's own labels
 * plus synthetic `severity`/`status`/`rule`/`kind` — and `slo` for
 * SLO-originated events — synthetics winning on collision. `kind` is "alert"
 * for instance events ("rule_health" for health events, which never reach
 * this UI path).
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
 * The dispatch-time label set of a live alert instance: {@link ccSyntheticLabels}
 * fed exactly as the dispatcher would — status "firing", `rule` as the source
 * uuid (for SLO-sourced instances too, matching CC's wire convention), and
 * `slo` stamped when the instance is SLO-sourced. Severity comes from the
 * owning rule, or for SLO instances from the burn-rate tier the `slo_tier`
 * label names against the owning SLO's resolved tiers (domain/slo.rs
 * `tier_severity`); "info" when the owner is unknown.
 */
export function ccDispatchLabels(
  alert: Pick<CcAlert, "labels" | "rule" | "slo">,
  rule: Pick<CcRuleView, "spec"> | undefined,
  slo?: Pick<CcSlo, "spec">,
): Record<string, string> {
  return ccSyntheticLabels(alert.labels, {
    severity:
      rule?.spec.severity ??
      (slo ? ccSloTierSeverity(ccSloTiers(slo.spec), alert.labels) : "info"),
    status: "firing",
    rule: alert.rule,
    ...(alert.slo !== undefined ? { slo: alert.slo } : {}),
  });
}

/**
 * Every route a dispatch of `labels` selects, mirroring CC's `select_receivers`
 * (dispatcher/routing.rs): walk by ascending priority, collect matches, stop
 * after the first match that does not set `continue`. Empty array means the
 * event falls through to the firehose.
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
 * The first silence active at `now` whose matchers all match `labels`, or null.
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
