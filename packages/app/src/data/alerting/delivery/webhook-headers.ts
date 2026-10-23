/**
 * Extra request headers on a webhook channel.
 *
 * The values are credentials (an Authorization bearer, a shared token). They
 * follow the URL: encrypted at rest, redacted on read, and omitted on write
 * to keep the saved value. The names are not secret. A channel list shows
 * them so an edit can say which header a blank value retains.
 *
 * The list is bounded because every notification repeats it, and the value
 * cap keeps one channel from carrying an unbounded body in a header.
 */
import { z } from "zod";

export const ALERTING_WEBHOOK_HEADERS_MAX = 16;
const ALERTING_WEBHOOK_HEADER_NAME_MAX = 128;
const ALERTING_WEBHOOK_HEADER_VALUE_MAX = 8_192;

// The read-side marker. Duplicated rather than imported from the channel
// schema: that schema imports this module.
const REDACTED_HEADER_VALUE = "***";

// RFC 9110 token. Spaces, colons, and CR/LF are out, so a name cannot
// smuggle a second header.
const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

// Fetch accepts a header value only as a ByteString: every code unit at most
// 255. A character above that saves, then Headers.append rejects it and the
// delivery fails for good.
function hasNonLatin1(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) > 0xff) return true;
  }
  return false;
}

// Names the send owns, or that rewrite the request rather than describe it.
// `content-type` stays application/json because the body is the notification.
// Hop-by-hop and Fetch-forbidden names are rejected here so the failure is
// the channel's validation, not an exception from fetch that may quote the
// value. `proxy-*` and `sec-*` are prefixes Fetch reserves.
const BLOCKED_HEADER_NAMES = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-encoding",
  "content-length",
  "content-type",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
]);

function webhookHeaderNameProblem(name: string): string | null {
  if (name.length === 0) return "header name is required";
  if (name.length > ALERTING_WEBHOOK_HEADER_NAME_MAX || !HEADER_NAME_RE.test(name)) {
    return "header name must be an HTTP token";
  }
  const lower = name.toLowerCase();
  if (BLOCKED_HEADER_NAMES.has(lower) || lower.startsWith("proxy-") || lower.startsWith("sec-")) {
    return `header ${name} cannot be set`;
  }
  return null;
}

function webhookHeaderValueProblem(value: string, opts: { allowRedacted: boolean }): string | null {
  if (!opts.allowRedacted && value === REDACTED_HEADER_VALUE) {
    return "the redacted channel secret cannot be written";
  }
  if (value.length === 0) return "header value is required";
  if (
    value.length > ALERTING_WEBHOOK_HEADER_VALUE_MAX ||
    value !== value.trim() ||
    hasControlCharacter(value)
  ) {
    return "header value must be a single line without control characters";
  }
  if (hasNonLatin1(value)) {
    return "header value must contain only latin-1 characters";
  }
  return null;
}

/** A stored or about-to-send header. Rejects a value the wire must not carry. */
export function webhookHeaderProblem(header: { name: string; value: string }): string | null {
  return (
    webhookHeaderNameProblem(header.name) ??
    webhookHeaderValueProblem(header.value, { allowRedacted: false })
  );
}

function headerNameSchema() {
  return z
    .string()
    .trim()
    .superRefine((name, ctx) => {
      const problem = webhookHeaderNameProblem(name);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    });
}

function headerValueSchema(allowRedacted: boolean) {
  return z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const problem = webhookHeaderValueProblem(value, { allowRedacted });
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    });
}

function uniqueHeaderNames(headers: { name: string }[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  for (const [index, header] of headers.entries()) {
    const key = header.name.toLowerCase();
    if (seen.has(key)) {
      ctx.addIssue({
        code: "custom",
        message: `header ${header.name} is already set`,
        path: [index, "name"],
      });
    }
    seen.add(key);
  }
}

const headersMax = {
  error: `a webhook accepts at most ${ALERTING_WEBHOOK_HEADERS_MAX} headers`,
} as const;

/** What a saved webhook holds. The redacted read uses the same schema, so a
 *  value of "***" has to parse here. */
export const WebhookHeadersSchema = z
  .array(
    z.object({
      name: headerNameSchema(),
      value: headerValueSchema(true),
    }),
  )
  .max(ALERTING_WEBHOOK_HEADERS_MAX, headersMax)
  .superRefine(uniqueHeaderNames);

/** What a write accepts. No default: omitting the list keeps the saved one,
 *  and an empty list clears it. Omitting a value keeps the saved value for
 *  that name. */
export const WebhookHeaderInputsSchema = z
  .array(
    z.object({
      name: headerNameSchema(),
      value: headerValueSchema(false).optional(),
    }),
  )
  .max(ALERTING_WEBHOOK_HEADERS_MAX, headersMax)
  .superRefine(uniqueHeaderNames);
