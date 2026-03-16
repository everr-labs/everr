// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => {
  const defaultConfig = {
    workerCount: 2,
    workerBatchSize: 10,
    maxAttempts: 10,
    pollIntervalMs: 2_000,
    lockDurationMs: 120_000,
    replayTimeoutMs: 30_000,
    tenantCacheTTLms: 60_000,
    retentionDoneDays: 7,
    retentionDeadDays: 30,
    cleanupIntervalMs: 3_600_000,
  };

  return {
    config: { ...defaultConfig },
    defaultConfig,
    store: {
      claimEvents: vi.fn(),
      cleanup: vi.fn(),
    },
    processEvent: vi.fn(),
    sleep: vi.fn(),
  };
});

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    GH_EVENTS_CONFIG: runtimeMocks.config,
  };
});

vi.mock("./queue-store", () => ({
  getWebhookEventStore: () => runtimeMocks.store,
}));

vi.mock("./processor", () => ({
  processWebhookEvent: runtimeMocks.processEvent,
}));

vi.mock("./sleep", () => ({
  sleep: runtimeMocks.sleep,
}));

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

async function loadRuntimeModule() {
  return import("./runtime");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  runtimeMocks.store.claimEvents.mockReset();
  runtimeMocks.store.cleanup.mockReset();
  runtimeMocks.processEvent.mockReset();
  runtimeMocks.sleep.mockReset();
  Object.assign(runtimeMocks.config, runtimeMocks.defaultConfig);
  Reflect.deleteProperty(globalThis, "__everrGitHubEventsRuntimeManager");
});

describe("GitHubEventsRuntime", () => {
  it("runs worker and cleanup loops until closed", async () => {
    Object.assign(runtimeMocks.config, {
      workerCount: 1,
      pollIntervalMs: 1,
      cleanupIntervalMs: 2,
    });

    const { GitHubEventsRuntime } = await loadRuntimeModule();
    const processed: number[] = [];
    let pollSleeps = 0;
    let cleanupSleeps = 0;

    runtimeMocks.store.claimEvents
      .mockResolvedValueOnce([
        {
          id: 1,
          source: "github",
          eventId: "delivery-1",
          topic: "collector",
          attempts: 1,
          headers: {
            "x-github-event": ["workflow_run"],
          },
          body: Buffer.from("{}"),
        },
      ])
      .mockResolvedValue([]);
    runtimeMocks.store.cleanup.mockResolvedValue(undefined);
    runtimeMocks.processEvent.mockImplementation(async (event) => {
      processed.push(event.id);
    });
    runtimeMocks.sleep.mockImplementation(
      (delay: number, signal?: AbortSignal) => {
        if (!signal) {
          return Promise.resolve();
        }

        if (signal.aborted) {
          return Promise.reject(new Error("aborted"));
        }

        if (delay === 1 && pollSleeps === 0) {
          pollSleeps += 1;
          return Promise.resolve();
        }

        if (delay === 2 && cleanupSleeps === 0) {
          cleanupSleeps += 1;
          return Promise.resolve();
        }

        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      },
    );

    const runtime = new GitHubEventsRuntime();

    runtime.start();

    await vi.waitFor(() => {
      expect(processed).toEqual([1]);
      expect(runtimeMocks.store.cleanup).toHaveBeenCalledTimes(1);
    });

    await runtime.close();
  });

  it("drains claimed work without an extra poll sleep and processes a batch concurrently", async () => {
    Object.assign(runtimeMocks.config, {
      workerCount: 1,
      pollIntervalMs: 5,
      cleanupIntervalMs: 10_000,
    });

    const { GitHubEventsRuntime } = await loadRuntimeModule();
    const firstRelease = createDeferred<void>();
    const firstStarted = createDeferred<void>();
    const secondStarted = createDeferred<void>();

    runtimeMocks.store.claimEvents
      .mockResolvedValueOnce([
        {
          id: 1,
          source: "github",
          eventId: "delivery-1",
          topic: "collector",
          attempts: 1,
          headers: {
            "x-github-event": ["workflow_run"],
          },
          body: Buffer.from("{}"),
        },
        {
          id: 2,
          source: "github",
          eventId: "delivery-2",
          topic: "collector",
          attempts: 1,
          headers: {
            "x-github-event": ["workflow_run"],
          },
          body: Buffer.from("{}"),
        },
      ])
      .mockResolvedValue([])
      .mockResolvedValue([]);
    runtimeMocks.store.cleanup.mockResolvedValue(undefined);
    runtimeMocks.processEvent.mockImplementation(async (event) => {
      if (event.id === 1) {
        firstStarted.resolve();
        await firstRelease.promise;
        return;
      }

      secondStarted.resolve();
    });
    runtimeMocks.sleep.mockImplementation(
      (_delay: number, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            {
              once: true,
            },
          );
        }),
    );

    const runtime = new GitHubEventsRuntime();

    runtime.start();

    await firstStarted.promise;
    await secondStarted.promise;

    expect(runtimeMocks.sleep).not.toHaveBeenCalledWith(5, expect.anything());

    firstRelease.resolve();

    await vi.waitFor(() => {
      expect(runtimeMocks.store.claimEvents).toHaveBeenCalledTimes(2);
      expect(runtimeMocks.sleep).toHaveBeenCalledWith(5, expect.anything());
    });

    await runtime.close();
  });
});

describe("GitHubEventsRuntimeManager", () => {
  it("reuses the existing runtime in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const { GitHubEventsRuntime, GitHubEventsRuntimeManager } =
      await loadRuntimeModule();
    const start = vi
      .spyOn(GitHubEventsRuntime.prototype, "start")
      .mockResolvedValue(undefined);
    const close = vi
      .spyOn(GitHubEventsRuntime.prototype, "close")
      .mockResolvedValue(undefined);
    const manager = new GitHubEventsRuntimeManager();

    await manager.ensureStartedForApp();
    await manager.ensureStartedForApp();

    expect(start).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent startup calls in development", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const { GitHubEventsRuntime, GitHubEventsRuntimeManager } =
      await loadRuntimeModule();
    let resolveStart: (() => void) | undefined;
    const start = vi
      .spyOn(GitHubEventsRuntime.prototype, "start")
      .mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveStart = resolve;
          }),
      );
    const close = vi
      .spyOn(GitHubEventsRuntime.prototype, "close")
      .mockResolvedValue(undefined);
    const manager = new GitHubEventsRuntimeManager();

    const first = manager.ensureStartedForApp();
    const second = manager.ensureStartedForApp();

    await vi.waitFor(() => {
      expect(start).toHaveBeenCalledTimes(1);
    });

    resolveStart?.();
    await Promise.all([first, second]);

    expect(close).not.toHaveBeenCalled();
  });

  it("restarts the runtime on a later development call", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const { GitHubEventsRuntime, GitHubEventsRuntimeManager } =
      await loadRuntimeModule();
    const start = vi
      .spyOn(GitHubEventsRuntime.prototype, "start")
      .mockResolvedValue(undefined);
    const close = vi
      .spyOn(GitHubEventsRuntime.prototype, "close")
      .mockResolvedValue(undefined);
    const manager = new GitHubEventsRuntimeManager();

    await manager.ensureStartedForApp();
    await manager.ensureStartedForApp();

    expect(start).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
