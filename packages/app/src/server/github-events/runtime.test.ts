// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.INGRESS_SOURCE = "github";
  process.env.INGRESS_COLLECTOR_URL = "http://localhost:8080/webhook/github";
  process.env.CDEVENTS_CLICKHOUSE_URL = "http://localhost:8123";
  process.env.CDEVENTS_CLICKHOUSE_USERNAME = "app_cdevents_rw";
  process.env.CDEVENTS_CLICKHOUSE_PASSWORD = "app-cdevents-dev";
  process.env.CDEVENTS_CLICKHOUSE_DATABASE = "app";
});

import { getGitHubEventsConfig } from "./config";

function createTestConfig(
  overrides: Partial<ReturnType<typeof getGitHubEventsConfig>> = {},
) {
  return {
    ...getGitHubEventsConfig(),
    workerCount: 1,
    pollIntervalMs: 1,
    cleanupIntervalMs: 2,
    ...overrides,
  };
}

function buildRuntimeFactory() {
  const runtimes: Array<{
    start: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }> = [];

  const createRuntime = () => {
    const runtime = {
      start: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    runtimes.push(runtime);
    return runtime;
  };

  return { createRuntime, runtimes };
}

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
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/postgres",
  );
  return import("./runtime");
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(globalThis, "__everrGitHubEventsRuntimeManager");
});

describe("GitHubEventsRuntime", () => {
  it("runs worker and cleanup loops until closed", async () => {
    const { GitHubEventsRuntime } = await loadRuntimeModule();
    const processed: number[] = [];
    let pollSleeps = 0;
    let cleanupSleeps = 0;
    const store = {
      claimEvents: vi
        .fn()
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
        .mockResolvedValue([]),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
    const writer = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    const sleep = vi.fn((delay: number, signal?: AbortSignal) => {
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
    });
    const runtime = new GitHubEventsRuntime({
      config: createTestConfig(),
      store: store as never,
      writer,
      processEvent: async (event) => {
        processed.push(event.id);
      },
      sleep,
    });

    runtime.start();

    await vi.waitFor(() => {
      expect(processed).toEqual([1]);
      expect(store.cleanup).toHaveBeenCalledTimes(1);
    });

    await runtime.close();

    expect(writer.close).toHaveBeenCalledTimes(1);
  });

  it("drains claimed work without an extra poll sleep and processes a batch concurrently", async () => {
    const { GitHubEventsRuntime } = await loadRuntimeModule();
    const firstRelease = createDeferred<void>();
    const firstStarted = createDeferred<void>();
    const secondStarted = createDeferred<void>();
    const claimEvents = vi
      .fn()
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
    const store = {
      claimEvents,
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
    const writer = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    const sleep = vi.fn((delay: number, signal?: AbortSignal) => {
      if (delay !== 5) {
        return new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            {
              once: true,
            },
          );
        });
      }

      return new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    });
    const runtime = new GitHubEventsRuntime({
      config: createTestConfig({
        workerCount: 1,
        pollIntervalMs: 5,
        cleanupIntervalMs: 10_000,
      }),
      store: store as never,
      writer,
      processEvent: async (event) => {
        if (event.id === 1) {
          firstStarted.resolve();
          await firstRelease.promise;
          return;
        }

        secondStarted.resolve();
      },
      sleep,
    });

    runtime.start();

    await firstStarted.promise;
    await secondStarted.promise;

    expect(sleep).not.toHaveBeenCalledWith(5, expect.anything());

    firstRelease.resolve();

    await vi.waitFor(() => {
      expect(claimEvents).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledWith(5, expect.anything());
    });

    await runtime.close();
  });
});

describe("GitHubEventsRuntimeManager", () => {
  it("reuses the existing runtime in production", async () => {
    const { GitHubEventsRuntimeManager } = await loadRuntimeModule();
    const { createRuntime, runtimes } = buildRuntimeFactory();
    const manager = new GitHubEventsRuntimeManager({
      createRuntime,
      isProduction: () => true,
    });

    await manager.ensureStartedForApp();
    await manager.ensureStartedForApp();

    expect(runtimes).toHaveLength(1);
    expect(runtimes[0]?.start).toHaveBeenCalledTimes(1);
    expect(runtimes[0]?.close).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent startup calls in development", async () => {
    const { GitHubEventsRuntimeManager } = await loadRuntimeModule();
    let resolveStart: (() => void) | undefined;
    const runtimes: Array<{
      start: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    const manager = new GitHubEventsRuntimeManager({
      createRuntime: () => {
        const runtime = {
          start: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                resolveStart = resolve;
              }),
          ),
          close: vi.fn().mockResolvedValue(undefined),
        };
        runtimes.push(runtime);
        return runtime;
      },
      isProduction: () => false,
    });

    const first = manager.ensureStartedForApp();
    const second = manager.ensureStartedForApp();
    await vi.waitFor(() => {
      expect(runtimes).toHaveLength(1);
      expect(runtimes[0]?.start).toHaveBeenCalledTimes(1);
    });

    resolveStart?.();
    await Promise.all([first, second]);

    expect(runtimes[0]?.close).not.toHaveBeenCalled();
  });

  it("restarts the runtime on a later development call", async () => {
    const { GitHubEventsRuntimeManager } = await loadRuntimeModule();
    const { createRuntime, runtimes } = buildRuntimeFactory();
    const manager = new GitHubEventsRuntimeManager({
      createRuntime,
      isProduction: () => false,
    });

    await manager.ensureStartedForApp();
    await manager.ensureStartedForApp();

    expect(runtimes).toHaveLength(2);
    expect(runtimes[0]?.close).toHaveBeenCalledTimes(1);
    expect(runtimes[1]?.start).toHaveBeenCalledTimes(1);
  });
});
