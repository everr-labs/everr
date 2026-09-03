/**
 * Matchers as text: the one line the Silence dialog takes in and the two lists
 * print back.
 *
 * Both directions live here and read one operator table, because they have to
 * agree exactly. "Silence again" and Undo seed the dialog from a rendered
 * silence's scope, so whatever `formatMatchers` prints, `parseMatchers` has to
 * read back to the same matchers. Written apart, a `ne` matcher once came back
 * as a label ending in `!`, which selects nothing and mutes nothing.
 *
 * Which is why a field that would not survive the trip is quoted. A silence
 * written through the as-code API can hold any value at all, and `service=a,`
 * printed bare read back as `service=a`: a silence that came back narrower
 * than the one it was seeded from, which is the failure this module exists to
 * prevent.
 */
import type { AlertingMatcher } from "@/data/alerting/types";

const OPERATOR: Record<AlertingMatcher["op"], string> = { eq: "=", ne: "!=" };

/** What ends one matcher and starts the next. */
const SEPARATOR = /[\s,]/;

/** A label prints bare when nothing in it can be read as something else. The
 *  separators end the matcher, a quote opens a quoted field, and the first `=`
 *  in a token ends the label, with a `!` before it taken as the operator. */
const BARE_LABEL = /^[^\s,="!]+$/;

/** A value prints bare on looser terms: it runs to the end of its token, so a
 *  `=` or a `!` inside it is already read as part of it and stays as the
 *  person typed it. Only a separator, or a quote in the opening position,
 *  would read as something else. The empty value is bare: `host=` is how a
 *  label that is present and blank is written. */
const BARE_VALUE = /^(?![\s,"])[^\s,]*$/;

const quoted = (field: string) => `"${field.replace(/["\\]/g, "\\$&")}"`;

/** `label=value` and `label!=value`, space separated, each field quoted where
 *  printing it bare would not read back. */
export const formatMatchers = (matchers: AlertingMatcher[]): string =>
  matchers
    .map((m) => {
      const label = BARE_LABEL.test(m.label) ? m.label : quoted(m.label);
      const value = BARE_VALUE.test(m.value) ? m.value : quoted(m.value);
      return `${label}${OPERATOR[m.op]}${value}`;
    })
    .join(" ");

/** One quoted field and where it ends. `\` escapes the next character, so a
 *  value may hold both quotes and backslashes. */
function readQuoted(input: string, from: number): [string, number] {
  let at = from + 1;
  let field = "";
  while (at < input.length && input[at] !== '"') {
    if (input[at] === "\\" && at + 1 < input.length) at += 1;
    field += input[at];
    at += 1;
  }
  if (at >= input.length) {
    throw new Error(`matcher has an unclosed quote: ${input.slice(from)}`);
  }
  return [field, at + 1];
}

/** The token an error is about, for a message that names what was refused. */
const tokenAt = (input: string, from: number) =>
  input.slice(from).split(SEPARATOR)[0];

/** Free-form `label=value` and `label!=value` pairs, space or comma separated,
 *  either side optionally quoted. Anything that is not a pair is rejected
 *  rather than silently widening the silence.
 *
 *  `!=` is read as the operator only where the `!` sits immediately before the
 *  token's first `=`: `service!=search` negates, `query=a!=b` is a value that
 *  happens to contain one. Reading it anywhere else would take the operator
 *  out of the middle of a value. */
export function parseMatchers(input: string): AlertingMatcher[] {
  const matchers: AlertingMatcher[] = [];
  let at = 0;
  while (at < input.length) {
    if (SEPARATOR.test(input[at])) {
      at += 1;
      continue;
    }
    const start = at;

    let label: string;
    if (input[at] === '"') {
      [label, at] = readQuoted(input, at);
    } else {
      let end = at;
      while (
        end < input.length &&
        !SEPARATOR.test(input[end]) &&
        input[end] !== OPERATOR.eq
      ) {
        end += 1;
      }
      // The `!` before the token's first `=` is the operator's, not the
      // label's, so the label stops short of it.
      const negating = input[end] === OPERATOR.eq && input[end - 1] === "!";
      at = negating ? end - 1 : end;
      label = input.slice(start, at);
    }

    const negated = input[at] === "!" && input[at + 1] === OPERATOR.eq;
    if (negated) at += 1;
    if (label === "" || input[at] !== OPERATOR.eq) {
      throw new Error(`matcher must be label=value: ${tokenAt(input, start)}`);
    }
    at += 1;

    let value: string;
    if (input[at] === '"') {
      [value, at] = readQuoted(input, at);
    } else {
      let end = at;
      while (end < input.length && !SEPARATOR.test(input[end])) end += 1;
      value = input.slice(at, end);
      at = end;
    }

    matchers.push({ label, op: negated ? "ne" : "eq", value });
  }
  return matchers;
}
