import { GH_EVENTS_CONFIG } from "./config";
import { processWebhookEvent } from "./processor";
import { getWebhookEventStore } from "./queue-store";
import { sleep } from "./sleep";

type ManagedRuntime = {
  start(): Promise<void> | void;
  close(): Promise<void>;
};

type AppStartState = {
  promise: Promise<void>;
  started: boolean;
};

export class GitHubEventsRuntime implements ManagedRuntime {
  private readonly abortController = new AbortController();
  private runPromise: Promise<void> | undefined;

  start() {
    if (this.runPromise) {
      return;
    }

    console.error("starting github events runtime");

    const loops: Promise<void>[] = [];
    for (let index = 0; index < GH_EVENTS_CONFIG.workerCount; index += 1) {
      loops.push(this.runWorkerLoop(index + 1));
    }
    loops.push(this.runCleanupLoop());

    this.runPromise = Promise.all(loops).then(() => undefined);
  }

  async close() {
    console.error("closing github events runtime");
    this.abortController.abort();
    await this.runPromise?.catch(() => undefined);
  }

  private async runWorkerLoop(workerId: number): Promise<void> {
    while (!this.abortController.signal.aborted) {
      let shouldSleep = true;

      try {
        const events = await getWebhookEventStore().claimEvents();
        if (events.length > 0) {
          shouldSleep = false;

          const results = await Promise.allSettled(
            events.map((event) =>
              processWebhookEvent(event, this.abortController.signal),
            ),
          );

          for (const result of results) {
            if (result.status === "rejected") {
              console.error("[github-events] event processing failed", {
                workerId,
                error: result.reason,
              });
            }
          }
        }
      } catch (error) {
        console.error("[github-events] worker failed", { workerId, error });
      }

      if (!shouldSleep) {
        continue;
      }

      try {
        await sleep(
          GH_EVENTS_CONFIG.pollIntervalMs,
          this.abortController.signal,
        );
      } catch {
        return;
      }
    }
  }

  private async runCleanupLoop(): Promise<void> {
    while (!this.abortController.signal.aborted) {
      try {
        await sleep(
          GH_EVENTS_CONFIG.cleanupIntervalMs,
          this.abortController.signal,
        );
      } catch {
        return;
      }

      try {
        await getWebhookEventStore().cleanup();
      } catch (error) {
        console.error("[github-events] cleanup failed", error);
      }
    }
  }
}

export class GitHubEventsRuntimeManager {
  private runtimePromise: Promise<ManagedRuntime> | undefined;
  private appStartState: AppStartState | undefined;

  ensureStarted(): Promise<ManagedRuntime> {
    if (!this.runtimePromise) {
      this.runtimePromise = this.startRuntime().catch((error) => {
        this.runtimePromise = undefined;
        throw error;
      });
    }

    return this.runtimePromise;
  }

  ensureStartedForApp(): Promise<void> {
    const state = this.appStartState;
    if (!state) {
      return this.trackAppStart(this.ensureStarted());
    }

    if (process.env.NODE_ENV === "production" || !state.started) {
      return state.promise;
    }

    return this.trackAppStart(
      state.promise.catch(() => undefined).then(() => this.restart()),
    );
  }

  async restart(): Promise<ManagedRuntime> {
    await this.stop();
    return this.ensureStarted();
  }

  async stop(): Promise<void> {
    this.appStartState = undefined;

    const runtimePromise = this.runtimePromise;
    this.runtimePromise = undefined;

    if (!runtimePromise) {
      return;
    }

    const runtime = await runtimePromise.catch(() => undefined);
    if (!runtime) {
      return;
    }

    await runtime.close();
  }

  private async startRuntime(): Promise<ManagedRuntime> {
    const runtime = new GitHubEventsRuntime();
    await runtime.start();
    return runtime;
  }

  private trackAppStart(
    runtimePromise: Promise<ManagedRuntime>,
  ): Promise<void> {
    const promise = runtimePromise.then(() => undefined);
    const state = {
      promise,
      started: false,
    };

    this.appStartState = state;

    void promise
      .then(() => {
        if (this.appStartState === state) {
          state.started = true;
        }
      })
      .catch(() => {
        if (this.appStartState === state) {
          this.appStartState = undefined;
        }
      });

    return promise;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __everrGitHubEventsRuntimeManager: GitHubEventsRuntimeManager | undefined;
}

function getGitHubEventsRuntimeManager(): GitHubEventsRuntimeManager {
  if (!globalThis.__everrGitHubEventsRuntimeManager) {
    globalThis.__everrGitHubEventsRuntimeManager =
      new GitHubEventsRuntimeManager();
  }

  return globalThis.__everrGitHubEventsRuntimeManager;
}

export function ensureGitHubEventsRuntimeForAppStart(): Promise<void> {
  return getGitHubEventsRuntimeManager().ensureStartedForApp();
}

export function ensureGitHubEventsRuntimeStarted(): Promise<ManagedRuntime> {
  return getGitHubEventsRuntimeManager().ensureStarted();
}

export function stopGitHubEventsRuntime(): Promise<void> {
  return getGitHubEventsRuntimeManager().stop();
}

export function restartGitHubEventsRuntime(): Promise<ManagedRuntime> {
  return getGitHubEventsRuntimeManager().restart();
}
