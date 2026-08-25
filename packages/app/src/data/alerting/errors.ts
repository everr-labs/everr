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
