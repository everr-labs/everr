/**
 * A clickety-clack API failure mapped to a thrown JS error: a problem+json
 * error response (`status` is the HTTP status), or a transport-level failure
 * (network error / timeout, `status` 0). Lives here, dependency-free, so
 * callers can `instanceof`-match it without importing the transport module
 * (and its env validation).
 */
export class CcApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CcApiError";
  }
}
