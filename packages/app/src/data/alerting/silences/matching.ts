import type { AlertingMatcher } from "../types";

/** Missing labels match as empty strings. Matching is exact only. */
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
  }
}

export function alertingMatchersMatch(
  matchers: AlertingMatcher[],
  labels: Record<string, string>,
): boolean {
  return matchers.every((m) => alertingMatcherMatches(m, labels));
}

/** Dispatcher labels, with system-owned values winning on collision. */
export function alertingSyntheticLabels(
  labels: Record<string, string>,
  opts: {
    severity: string;
    status: string;
    rule: string;
  },
): Record<string, string> {
  return {
    ...labels,
    severity: opts.severity,
    status: opts.status,
    rule: opts.rule,
  };
}

/** Half-open: a silence covers its start instant and not its end instant. */
function alertingSilenceIsActive(
  silence: { starts_at: string; ends_at: string },
  now: number,
): boolean {
  return (
    new Date(silence.starts_at).getTime() <= now &&
    now < new Date(silence.ends_at).getTime()
  );
}

/** First active silence whose matchers all match `labels`. */
export function alertingMatchingSilence<
  S extends { matchers: AlertingMatcher[]; starts_at: string; ends_at: string },
>(labels: Record<string, string>, silences: S[], now: number): S | null {
  return (
    silences.find(
      (s) =>
        alertingSilenceIsActive(s, now) &&
        alertingMatchersMatch(s.matchers, labels),
    ) ?? null
  );
}
