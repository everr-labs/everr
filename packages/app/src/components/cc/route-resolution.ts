// packages/app/src/components/cc/route-resolution.ts
// Pure, mirrors CC's matcher semantics. Used to show "where does this alert go"
// and to drive the routing pipeline preview. First match by ascending priority.
import type { CcMatcher, CcRoute } from "@/data/cc/types";

const OP_SYMBOL: Record<CcMatcher["op"], string> = {
  eq: "=",
  ne: "≠",
  regex: "=~",
  notregex: "!~",
};

export function ccOpSymbol(op: CcMatcher["op"]): string {
  return OP_SYMBOL[op];
}

export function ccMatcherMatches(
  m: CcMatcher,
  labels: Record<string, string>,
): boolean {
  const v = labels[m.label];
  switch (m.op) {
    case "eq":
      return v === m.value;
    case "ne":
      return v !== m.value;
    case "regex":
      try {
        return v != null && new RegExp(m.value).test(v);
      } catch {
        return false;
      }
    case "notregex":
      try {
        return v == null || !new RegExp(m.value).test(v);
      } catch {
        return false;
      }
  }
}

export function ccRouteMatches(
  matchers: CcMatcher[],
  labels: Record<string, string>,
): boolean {
  return matchers.every((m) => ccMatcherMatches(m, labels));
}

/** First route matching `labels`, by ascending priority (first match wins). */
export function ccFirstRoute(
  routes: CcRoute[],
  labels: Record<string, string>,
): CcRoute | null {
  return (
    [...routes]
      .sort((a, b) => a.priority - b.priority)
      .find((r) => ccRouteMatches(r.matchers, labels)) ?? null
  );
}

/**
 * The synthetic label keys the dispatcher injects, in CC's own order
 * (dispatcher/routing.rs `synthetic_labels`). The one list every suggestion
 * surface reads, so it cannot drift from ccSyntheticLabels below.
 */
export const CC_SYNTHETIC_LABEL_KEYS = [
  "severity",
  "status",
  "rule",
  "kind",
] as const;

/**
 * The label set CC's dispatcher actually matches routes/silences/inhibitions
 * against (dispatcher/routing.rs `synthetic_labels`): the instance's own labels
 * plus synthetic `severity`/`status`/`rule`/`kind`, synthetics winning on
 * collision. `kind` is "alert" for instance events ("rule_health" for health
 * events, which never reach this UI path).
 */
export function ccSyntheticLabels(
  labels: Record<string, string>,
  opts: { severity: string; status: string; rule: string; kind?: string },
): Record<string, string> {
  return {
    ...labels,
    severity: opts.severity,
    status: opts.status,
    rule: opts.rule,
    kind: opts.kind ?? "alert",
  };
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
