import type {
  AlertingAlert,
  AlertingMatcher,
  AlertingRuleView,
} from "../types";

const OP_SYMBOL = { eq: "=", ne: "≠" } satisfies Record<
  AlertingMatcher["op"],
  string
>;

export function alertingOpSymbol(op: AlertingMatcher["op"]): string {
  // A row persisted before an op was retired renders its raw op name, never
  // the string "undefined".
  return (OP_SYMBOL as Record<string, string | undefined>)[op] ?? op;
}

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

/** No matchers = matches every alert. */
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
  },
): Record<string, string> {
  return {
    ...labels,
    severity: opts.severity,
    status: opts.status,
    rule: opts.rule,
  };
}

/** Dispatch-time labels of a live rule instance. */
export function alertingDispatchLabels(
  alert: Pick<AlertingAlert, "labels" | "rule">,
  rule: Pick<AlertingRuleView, "spec"> | undefined,
): Record<string, string> {
  return alertingSyntheticLabels(alert.labels, {
    severity: rule?.spec.severity ?? "info",
    status: "firing",
    rule: alert.rule,
  });
}

/** Half-open: a silence covers its start instant and not its end instant. */
export function alertingSilenceIsActive(
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
