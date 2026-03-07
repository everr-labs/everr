// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
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
  Reflect.deleteProperty(globalThis, "__citricGitHubEventsRuntimeManager");
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
            tenantId: null,
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
