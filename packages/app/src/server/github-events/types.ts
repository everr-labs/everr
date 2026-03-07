export const githubEventSource = "github";
export const topicCollector = "collector";
export const topicCDEvents = "cdevents";

export type WebhookTopic = typeof topicCollector | typeof topicCDEvents;
export type WebhookHeaders = Record<string, string[]>;

export type WebhookEventRecord = {
  id: number;
  source: string;
  eventId: string;
  topic: WebhookTopic;
  headers: WebhookHeaders;
  body: Buffer;
  attempts: number;
};

export type FinalizeResult = "done" | "dead" | "failed";
export type EnqueueStatus = "inserted" | "duplicate" | "conflict";

export class TerminalEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalEventError";
  }
}
