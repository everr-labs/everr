/**
 * A CC API failure: problem+json response (`status` = HTTP status) or
 * transport failure (`status` 0). Dependency-free so callers can match it
 * without importing the transport module (and its env validation).
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
 * TanStack Start serializes thrown errors with seroval, which preserves
 * `name`/`message`/own properties but not class identity — the client gets a
 * plain `Error` named "CcApiError". So this matches structurally, not by
 * `instanceof`, and works on both sides of the server-fn boundary. Null for
 * anything that is not a CC API error.
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
