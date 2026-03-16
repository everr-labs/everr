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
