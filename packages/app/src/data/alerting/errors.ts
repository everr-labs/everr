/**
 * A structured alerting operation failure. The status and code remain plain
 * data so the error can cross a server-function boundary.
 */
export class AlertingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AlertingError";
  }
}

/** The machine-readable facts an AlertingError carries across the wire. */
export type AlertingErrorInfo = {
  /** HTTP-compatible status used by callers to classify the failure. */
  status: number;
  /** Stable machine-readable code, such as "conflict" or "validation". */
  code: string;
  message: string;
};

/**
 * TanStack Start serializes thrown errors with seroval, which preserves
 * `name`/`message`/own properties but not class identity — the client gets a
 * plain `Error` named "AlertingError". So this matches structurally, not by
 * `instanceof`, and works on both sides of the server-fn boundary. Null for
 * anything that is not a structured alerting error.
 */
export function alertingErrorInfo(error: unknown): AlertingErrorInfo | null {
  if (!(error instanceof Error) || error.name !== "AlertingError") return null;
  const { status, code } = error as Error & {
    status?: unknown;
    code?: unknown;
  };
  if (typeof status !== "number" || typeof code !== "string") return null;
  return { status, code, message: error.message };
}
