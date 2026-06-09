/**
 * A bad-input failure during apply — an unknown/missing resource kind, an
 * invalid slug or spec, or a duplicate. These are the caller's fault and map to
 * HTTP 400 with the message surfaced to the CLI. Anything else thrown during
 * apply (database/transaction/etc.) is an infrastructure failure: it must be
 * logged and returned as 5xx, never echoed back as if it were bad input.
 */
export class ApplyValidationError extends Error {
  name = "ApplyValidationError";
}
