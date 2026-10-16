export type WebhookHeaders = Record<string, string[]>;

export type WebhookJobData = {
  headers: WebhookHeaders;
  body: string; // base64
};

export class TerminalEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalEventError";
  }
}

// A terminal event for an installation we no longer have a mapping for. The task
// runner drops these quietly (no error telemetry) instead of treating them as
// bugs, so it branches on the type rather than the message text.
export class StaleInstallationError extends TerminalEventError {
  constructor(message: string) {
    super(message);
    this.name = "StaleInstallationError";
  }
}
