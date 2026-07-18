/**
 * A clickety-clack API failure mapped to a thrown JS error: a problem+json
 * error response (`status` is the HTTP status), or a transport-level failure
 * (network error / timeout, `status` 0). Lives here, dependency-free, so
 * callers can match it without importing the transport module (and its env
 * validation).
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

/** The machine-readable facts a CcApiError carries across the wire. */
export type CcErrorInfo = {
  /** HTTP status of CC's problem+json response; 0 for transport failures. */
  status: number;
  /** CC's problem+json `code` ("conflict", ...); "timeout"/"unreachable" for transport failures. */
  code: string;
  message: string;
};

/**
 * Decode a CcApiError from any error shape, including one that crossed the
 * server-fn boundary. TanStack Start serializes thrown errors with seroval,
 * which preserves an Error's `name`, `message`, and its own properties
 * (`status`, `code` here) but not its class identity — the client receives a
 * plain `Error` named "CcApiError". So this matches structurally (name +
 * typed fields) rather than by `instanceof`, and works on both sides of the
 * boundary. Returns null for anything that is not a CC API error.
 */
export function ccErrorInfo(error: unknown): CcErrorInfo | null {
  if (!(error instanceof Error) || error.name !== "CcApiError") return null;
  const { status, code } = error as Error & {
    status?: unknown;
    code?: unknown;
  };
  if (typeof status !== "number" || typeof code !== "string") return null;
  return { status, code, message: error.message };
}
