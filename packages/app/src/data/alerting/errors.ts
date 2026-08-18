/** An alerting error that can cross a server-function boundary. */
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

type AlertingErrorInfo = {
  status: number;
  code: string;
  message: string;
};

// Serialization preserves error fields but not class identity. Match the
// serialized structure so this function works on the client and server.
export function alertingErrorInfo(error: unknown): AlertingErrorInfo | null {
  if (!(error instanceof Error) || error.name !== "AlertingError") return null;
  const { status, code } = error as Error & {
    status?: unknown;
    code?: unknown;
  };
  if (typeof status !== "number" || typeof code !== "string") return null;
  return { status, code, message: error.message };
}
