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
