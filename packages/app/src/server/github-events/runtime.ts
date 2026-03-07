import { getCDEventsWriter } from "./cdevents";
import { type GitHubEventsConfig, getGitHubEventsConfig } from "./config";
import { processWebhookEvent } from "./processor";
import { getWebhookEventStore, type WebhookEventStore } from "./queue-store";
import { sleep } from "./sleep";

type ManagedRuntime = {
  start(): Promise<void> | void;
  close(): Promise<void>;
};

type AppStartState = {
  promise: Promise<void>;
  started: boolean;
};

type RuntimeManagerOptions = {
  createRuntime?: () => ManagedRuntime;
  isProduction?: () => boolean;
};

type RuntimeWriter = Pick<ReturnType<typeof getCDEventsWriter>, "close">;

export type GitHubEventsRuntimeDependencies = {
  config?: GitHubEventsConfig;
  store?: WebhookEventStore;
  writer?: RuntimeWriter;
  processEvent?: typeof processWebhookEvent;
  sleep?: typeof sleep;
};

export class GitHubEventsRuntime implements ManagedRuntime {
  private readonly abortController = new AbortController();
  private runPromise: Promise<void> | undefined;
  private readonly config: GitHubEventsConfig;
  private readonly store: WebhookEventStore;
  private readonly writer: RuntimeWriter;
  private readonly processEvent: typeof processWebhookEvent;
  private readonly sleepFn: typeof sleep;

  constructor(dependencies: GitHubEventsRuntimeDependencies = {}) {
    this.config = dependencies.config ?? getGitHubEventsConfig();
    this.store = dependencies.store ?? getWebhookEventStore();
    this.writer = dependencies.writer ?? getCDEventsWriter();
    this.processEvent = dependencies.processEvent ?? processWebhookEvent;
    this.sleepFn = dependencies.sleep ?? sleep;
  }

  start() {
    if (this.runPromise) {
      return;
    }

    console.error("starting github events runtime");

    const loops: Promise<void>[] = [];
    for (let index = 0; index < this.config.workerCount; index += 1) {
      loops.push(this.runWorkerLoop(index + 1));
    }
    loops.push(this.runCleanupLoop());

    this.runPromise = Promise.all(loops).then(() => undefined);
  }

  async close() {
    console.error("closing github events runtime");
    this.abortController.abort();
    await this.runPromise?.catch(() => undefined);
    await this.writer.close();
  }

  private async runWorkerLoop(workerId: number): Promise<void> {
    while (!this.abortController.signal.aborted) {
      let shouldSleep = true;

      try {
        const events = await this.store.claimEvents();
        if (events.length > 0) {
          shouldSleep = false;

          const results = await Promise.allSettled(
            events.map((event) =>
              this.processEvent(event, {}, this.abortController.signal),
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
        await this.sleepFn(
          this.config.pollIntervalMs,
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
        await this.sleepFn(
          this.config.cleanupIntervalMs,
          this.abortController.signal,
        );
      } catch {
        return;
      }

      try {
        await this.store.cleanup();
      } catch (error) {
        console.error("[github-events] cleanup failed", error);
      }
    }
  }
}

export class GitHubEventsRuntimeManager {
  private runtimePromise: Promise<ManagedRuntime> | undefined;
  private appStartState: AppStartState | undefined;
  private readonly createRuntime: () => ManagedRuntime;
  private readonly isProduction: () => boolean;

  constructor(options: RuntimeManagerOptions = {}) {
    this.createRuntime =
      options.createRuntime ?? (() => new GitHubEventsRuntime());
    this.isProduction =
      options.isProduction ?? (() => process.env.NODE_ENV === "production");
  }

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

    if (this.isProduction() || !state.started) {
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
    const runtime = this.createRuntime();
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
  var __citricGitHubEventsRuntimeManager:
    | GitHubEventsRuntimeManager
    | undefined;
}

function getGitHubEventsRuntimeManager(): GitHubEventsRuntimeManager {
  if (!globalThis.__citricGitHubEventsRuntimeManager) {
    globalThis.__citricGitHubEventsRuntimeManager =
      new GitHubEventsRuntimeManager();
  }

  return globalThis.__citricGitHubEventsRuntimeManager;
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
