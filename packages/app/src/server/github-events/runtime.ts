import { getCDEventsWriter } from "./cdevents";
import { getGitHubEventsConfig } from "./config";
import { processWebhookEvent } from "./processor";
import { getWebhookEventStore } from "./queue-store";
import { sleep } from "./sleep";

type GitHubEventsRuntime = {
  close(): Promise<void>;
};

declare global {
  // eslint-disable-next-line no-var
  var __citricGithubEventsRuntimePromise:
    | Promise<GitHubEventsRuntime>
    | undefined;
}

async function runWorkerLoop(
  signal: AbortSignal,
  workerId: number,
): Promise<void> {
  const store = getWebhookEventStore();
  const config = getGitHubEventsConfig();

  while (!signal.aborted) {
    try {
      const events = await store.claimEvents();
      for (const event of events) {
        await processWebhookEvent(event);
      }
    } catch (error) {
      console.error("[github-events] worker failed", { workerId, error });
    }

    try {
      await sleep(config.pollIntervalMs, signal);
    } catch {
      return;
    }
  }
}

async function runCleanupLoop(signal: AbortSignal): Promise<void> {
  const store = getWebhookEventStore();
  const config = getGitHubEventsConfig();

  while (!signal.aborted) {
    try {
      await sleep(config.cleanupIntervalMs, signal);
    } catch {
      return;
    }

    try {
      await store.cleanup();
    } catch (error) {
      console.error("[github-events] cleanup failed", error);
    }
  }
}

async function createRuntime(): Promise<GitHubEventsRuntime> {
  const config = getGitHubEventsConfig();
  const writer = getCDEventsWriter();
  const abortController = new AbortController();

  for (let index = 0; index < config.workerCount; index += 1) {
    void runWorkerLoop(abortController.signal, index + 1);
  }
  void runCleanupLoop(abortController.signal);

  return {
    async close() {
      abortController.abort();
      await writer.close();
    },
  };
}

export async function ensureGitHubEventsRuntimeStarted(): Promise<GitHubEventsRuntime> {
  if (!globalThis.__citricGithubEventsRuntimePromise) {
    globalThis.__citricGithubEventsRuntimePromise = createRuntime().catch(
      (error) => {
        globalThis.__citricGithubEventsRuntimePromise = undefined;
        throw error;
      },
    );
  }

  return globalThis.__citricGithubEventsRuntimePromise;
}
