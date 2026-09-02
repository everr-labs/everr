/**
 * Matchers as text: the one line the Silence dialog takes in and the two lists
 * print back.
 *
 * Both directions live here and read one operator table, because they have to
 * agree exactly. "Silence again" and Undo seed the dialog from a rendered
 * silence's scope, so whatever `formatMatchers` prints, `parseMatchers` has to
 * read back to the same matchers. Written apart, a `ne` matcher once came back
 * as a label ending in `!`, which selects nothing and mutes nothing.
 */
import type { AlertingMatcher } from "@/data/alerting/types";

const OPERATOR: Record<AlertingMatcher["op"], string> = { eq: "=", ne: "!=" };

/** `label=value` and `label!=value`, space separated. */
export const formatMatchers = (matchers: AlertingMatcher[]): string =>
  matchers.map((m) => `${m.label}${OPERATOR[m.op]}${m.value}`).join(" ");

/** Free-form `label=value` and `label!=value` pairs, space or comma separated.
 *  Anything that is not a pair is rejected rather than silently widening the
 *  silence.
 *
 *  `!=` is read as the operator only where the `!` sits immediately before the
 *  token's first `=`: `service!=search` negates, `query=a!=b` is a value that
 *  happens to contain one. Reading it anywhere else would take the operator
 *  out of the middle of a value. */
export function parseMatchers(input: string): AlertingMatcher[] {
  return input
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((token): AlertingMatcher => {
      const eq = token.indexOf(OPERATOR.eq);
      const negated = eq > 0 && token.startsWith(OPERATOR.ne, eq - 1);
      const at = negated ? eq - 1 : eq;
      if (at <= 0) throw new Error(`matcher must be label=value: ${token}`);
      return {
        label: token.slice(0, at),
        op: negated ? "ne" : "eq",
        value: token.slice(eq + 1),
      };
    });
}
