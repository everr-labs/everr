import * as z from "zod";

const MatcherSchema = z
  .object({
    label: z.string().min(1).max(200),
    op: z.enum(["=", "!=", "=~", "!~"]),
    value: z.string().max(1000),
  })
  .strict();

export const MatchersSchema = z.array(MatcherSchema).max(20);

export type Matcher = z.infer<typeof MatcherSchema>;

function compileAnchored(value: string): RegExp {
  return new RegExp(`^(?:${value})$`);
}

export function validateMatchers(matchers: readonly Matcher[]): void {
  for (const matcher of matchers) {
    if (matcher.op !== "=~" && matcher.op !== "!~") continue;
    try {
      compileAnchored(matcher.value);
    } catch {
      throw new Error(
        `invalid regex in matcher ${matcher.label}${matcher.op}"${matcher.value}"`,
      );
    }
  }
}

export function matcherMatches(
  matcher: Matcher,
  labels: Record<string, string>,
): boolean {
  const value = labels[matcher.label] ?? "";
  switch (matcher.op) {
    case "=":
      return value === matcher.value;
    case "!=":
      return value !== matcher.value;
    case "=~":
      return compileAnchored(matcher.value).test(value);
    case "!~":
      return !compileAnchored(matcher.value).test(value);
  }
}

export function silenceMatchesInstance(
  matchers: readonly Matcher[],
  labels: Record<string, string>,
): boolean {
  return matchers.every((matcher) => matcherMatches(matcher, labels));
}

export function formatLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "(no labels)";
  return entries.map(([key, value]) => `${key}=${value}`).join(", ");
}

export function findSilenceForInstance<S extends { matchers: Matcher[] }>(
  silences: readonly S[],
  labels: Record<string, string>,
): S | undefined {
  return silences.find((silence) =>
    silenceMatchesInstance(silence.matchers, labels),
  );
}
