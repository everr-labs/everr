import { db as defaultDb } from "@/db/client";
import { replayWebhookToCollector } from "./collector";
import { GH_EVENTS_CONFIG } from "./config";
import { firstHeader } from "./headers";
import {
  installationIdFromQueuedEvent,
  parseQueuedWorkflowEvent,
} from "./payloads";
import { getWebhookEventStore, type WebhookEventStore } from "./queue-store";
import { sleep } from "./sleep";
import { handleStatusEvent } from "./status-writer";
import { getTenantResolver } from "./tenant-resolver";
import type { WebhookEventRecord } from "./types";
import { TerminalEventError, topicCollector, topicStatus } from "./types";

const finalizeRetryDelayMs = 1000;

export async function processWebhookEvent(
  event: WebhookEventRecord,
  signal?: AbortSignal,
) {
  const store = getWebhookEventStore();

  const eventType = firstHeader(event.headers, "x-github-event")?.trim() ?? "";
  if (!eventType) {
    await finalizeClaim(
      {
        store,
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
    const tenantId = await getTenantResolver().resolveTenantId(installationId);

    if (event.topic === topicCollector) {
      await replayWebhookToCollector(event, tenantId);
    } else if (event.topic === topicStatus) {
      await handleStatusEvent(
        defaultDb as unknown as Parameters<typeof handleStatusEvent>[0],
        tenantId,
        parsedEvent,
      );
    } else {
      throw new TerminalEventError(`unsupported topic "${event.topic}"`);
    }

    await finalizeClaim(
      {
        store,
        eventId: event.id,
        attempts: event.attempts,
        result: "done",
      },
      signal,
    );
  } catch (error) {
    const isTerminal = error instanceof TerminalEventError;
    const result =
      isTerminal || event.attempts >= GH_EVENTS_CONFIG.maxAttempts
        ? "dead"
        : "failed";

    await finalizeClaim(
      {
        store,
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

      await sleep(finalizeRetryDelayMs, signal);
    }
  }
}
