import { handleCDEventsRequest } from "./cdevents";
import { replayWebhookToCollector, tenantHeaderName } from "./collector";
import { type GitHubEventsConfig, getGitHubEventsConfig } from "./config";
import { firstHeader, recordToHeaders } from "./headers";
import {
  installationIdFromQueuedEvent,
  parseQueuedWorkflowEvent,
} from "./payloads";
import { getWebhookEventStore, type WebhookEventStore } from "./queue-store";
import { sleep } from "./sleep";
import { getTenantResolver, type TenantResolver } from "./tenant-resolver";
import type { WebhookEventRecord } from "./types";
import { TerminalEventError, topicCDEvents, topicCollector } from "./types";

type ProcessorDependencies = {
  config?: GitHubEventsConfig;
  store?: WebhookEventStore;
  tenantResolver?: TenantResolver;
  replayCollector?: typeof replayWebhookToCollector;
  handleCDEvents?: typeof handleCDEventsRequest;
  sleep?: typeof sleep;
};

const finalizeRetryDelayMs = 1000;

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
  signal?: AbortSignal,
) {
  const config = dependencies.config ?? getGitHubEventsConfig();
  const store = dependencies.store ?? getWebhookEventStore();
  const tenantResolver = dependencies.tenantResolver ?? getTenantResolver();
  const replayCollector =
    dependencies.replayCollector ?? replayWebhookToCollector;
  const handleCDEvents = dependencies.handleCDEvents ?? handleCDEventsRequest;
  const sleepFn = dependencies.sleep ?? sleep;

  const eventType = firstHeader(event.headers, "x-github-event")?.trim() ?? "";
  if (!eventType) {
    await finalizeClaim(
      {
        store,
        sleepFn,
        eventId: event.id,
        attempts: event.attempts,
        result: "dead",
        errorClass: "terminal",
        lastError: "missing x-github-event header",
      },
      signal,
    );
    return;
  }

  try {
    const parsedEvent = parseQueuedWorkflowEvent(eventType, event.body);
    const installationId = installationIdFromQueuedEvent(parsedEvent);
    const tenantId = await tenantResolver.resolveTenantId(installationId);

    if (event.topic === topicCollector) {
      await replayCollector(event, tenantId, config);
    } else if (event.topic === topicCDEvents) {
      const headers = recordToHeaders(event.headers);
      headers.set(tenantHeaderName, String(tenantId));
      const response = await handleCDEvents(
        new Request("http://everr.internal/cdevents", {
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

    await finalizeClaim(
      {
        store,
        sleepFn,
        eventId: event.id,
        attempts: event.attempts,
        result: "done",
      },
      signal,
    );
  } catch (error) {
    const isTerminal = error instanceof TerminalEventError;
    const result =
      isTerminal || event.attempts >= config.maxAttempts ? "dead" : "failed";

    await finalizeClaim(
      {
        store,
        sleepFn,
        eventId: event.id,
        attempts: event.attempts,
        result,
        errorClass: isTerminal ? "terminal" : "retryable",
        lastError: error instanceof Error ? error.message : String(error),
      },
      signal,
    );
  }
}

async function finalizeClaim(
  args: {
    store: WebhookEventStore;
    sleepFn: typeof sleep;
    eventId: number;
    attempts: number;
    result: "done" | "dead" | "failed";
    errorClass?: string;
    lastError?: string;
  },
  signal?: AbortSignal,
) {
  while (true) {
    try {
      return await args.store.finalizeEvent({
        eventId: args.eventId,
        attempts: args.attempts,
        result: args.result,
        errorClass: args.errorClass,
        lastError: args.lastError,
      });
    } catch {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("aborted");
      }

      try {
        const renewed = await args.store.renewEventLock({
          eventId: args.eventId,
          attempts: args.attempts,
        });

        if (!renewed) {
          return false;
        }
      } catch {
        // Best effort only. If the database is temporarily unavailable, retry
        // finalization without replaying the side effect.
      }

      await args.sleepFn(finalizeRetryDelayMs, signal);
    }
  }
}
