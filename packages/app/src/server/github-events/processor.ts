import { handleCDEventsRequest } from "./cdevents";
import { replayWebhookToCollector, tenantHeaderName } from "./collector";
import { type GitHubEventsConfig, getGitHubEventsConfig } from "./config";
import { firstHeader, recordToHeaders } from "./headers";
import {
  installationIdFromQueuedEvent,
  parseQueuedWorkflowEvent,
} from "./payloads";
import { getWebhookEventStore, type WebhookEventStore } from "./queue-store";
import { getTenantResolver, type TenantResolver } from "./tenant-resolver";
import type { WebhookEventRecord } from "./types";
import { TerminalEventError, topicCDEvents, topicCollector } from "./types";

type ProcessorDependencies = {
  config?: GitHubEventsConfig;
  store?: WebhookEventStore;
  tenantResolver?: TenantResolver;
  replayCollector?: typeof replayWebhookToCollector;
  handleCDEvents?: typeof handleCDEventsRequest;
};

function responseToError(name: string, response: Response): Error {
  const message = `${name} status=${response.status}`;
  if (
    response.status === 408 ||
    response.status === 429 ||
    (response.status >= 500 && response.status <= 599)
  ) {
    return new Error(message);
  }

  return new TerminalEventError(message);
}

export async function processWebhookEvent(
  event: WebhookEventRecord,
  dependencies: ProcessorDependencies = {},
) {
  const config = dependencies.config ?? getGitHubEventsConfig();
  const store = dependencies.store ?? getWebhookEventStore();
  const tenantResolver = dependencies.tenantResolver ?? getTenantResolver();
  const replayCollector =
    dependencies.replayCollector ?? replayWebhookToCollector;
  const handleCDEvents = dependencies.handleCDEvents ?? handleCDEventsRequest;

  const eventType = firstHeader(event.headers, "x-github-event")?.trim() ?? "";
  if (!eventType) {
    await store.finalizeEvent({
      eventId: event.id,
      attempts: event.attempts,
      result: "dead",
      errorClass: "terminal",
      lastError: "missing x-github-event header",
    });
    return;
  }

  try {
    const parsedEvent = parseQueuedWorkflowEvent(eventType, event.body);
    const installationId = installationIdFromQueuedEvent(parsedEvent);
    const tenantId =
      event.tenantId ?? (await tenantResolver.resolveTenantId(installationId));

    if (!event.tenantId) {
      await store.persistTenantId(event.id, tenantId);
    }

    if (event.topic === topicCollector) {
      await replayCollector(event, tenantId, config);
    } else if (event.topic === topicCDEvents) {
      const headers = recordToHeaders(event.headers);
      headers.set(tenantHeaderName, String(tenantId));
      const response = await handleCDEvents(
        new Request("http://citric.internal/cdevents", {
          method: "POST",
          headers,
          body: new Uint8Array(event.body),
        }),
      );

      if (!response.ok) {
        throw responseToError("cdevents", response);
      }
    } else {
      throw new TerminalEventError(`unsupported topic "${event.topic}"`);
    }

    await store.finalizeEvent({
      eventId: event.id,
      attempts: event.attempts,
      result: "done",
    });
  } catch (error) {
    const isTerminal = error instanceof TerminalEventError;
    await store.finalizeEvent({
      eventId: event.id,
      attempts: event.attempts,
      result:
        isTerminal || event.attempts >= config.maxAttempts ? "dead" : "failed",
      errorClass: isTerminal ? "terminal" : "retryable",
      lastError: error instanceof Error ? error.message : String(error),
    });
  }
}
