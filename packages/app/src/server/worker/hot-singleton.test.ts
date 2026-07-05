// @vitest-environment node
import { describe, expect, it, vi } from "vite-plus/test";
import { hotSingleton } from "./hot-singleton";

let keyCounter = 0;
// A fresh registry slot per test keeps the globalThis registry from bleeding
// state across cases.
function uniqueKey() {
  keyCounter += 1;
  return `test-singleton-${keyCounter}`;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMockHot() {
  const disposeCallbacks: Array<(data: unknown) => void> = [];
  let accepted = false;
  return {
    hot: {
      accept() {
        accepted = true;
      },
      dispose(cb: (data: unknown) => void) {
        disposeCallbacks.push(cb);
      },
    },
    triggerDispose() {
      for (const cb of disposeCallbacks) cb(undefined);
    },
    get accepted() {
      return accepted;
    },
  };
}

// Yield long enough for queued microtasks to drain.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("hotSingleton", () => {
  it("starts lazily and memoizes the resource", async () => {
    const value = { id: 1 };
    const start = vi.fn(async () => value);
    const stop = vi.fn(async () => {});
    const singleton = hotSingleton({
      key: uniqueKey(),
      start,
      stop,
      hot: undefined,
    });

    expect(start).not.toHaveBeenCalled();

    const [a, b] = await Promise.all([singleton.start(), singleton.start()]);

    expect(start).toHaveBeenCalledOnce();
    expect(a).toBe(value);
    expect(b).toBe(value);
  });

  it("stop awaits an in-flight start, then tears down with the value", async () => {
    const value = { id: 7 };
    const startGate = deferred<void>();
    const start = vi.fn(async () => {
      await startGate.promise;
      return value;
    });
    const stop = vi.fn(async () => {});
    const singleton = hotSingleton({
      key: uniqueKey(),
      start,
      stop,
      hot: undefined,
    });

    const starting = singleton.start();
    const stopping = singleton.stop();
    startGate.resolve();
    await starting;
    await stopping;

    expect(stop).toHaveBeenCalledWith(value);
  });

  it("serializes a restart so start and stop never overlap", async () => {
    const events: string[] = [];
    const stopGate = deferred<void>();
    const start = vi.fn(async () => {
      events.push("start");
      return { id: 1 };
    });
    const stop = vi.fn(async () => {
      events.push("stop:begin");
      await stopGate.promise;
      events.push("stop:end");
    });
    const singleton = hotSingleton({
      key: uniqueKey(),
      start,
      stop,
      hot: undefined,
    });

    await singleton.start();
    const stopping = singleton.stop();
    const restart = singleton.start();
    await flush();

    // The restart must not begin until the stop has finished.
    expect(events).toEqual(["start", "stop:begin"]);

    stopGate.resolve();
    await stopping;
    await restart;

    expect(events).toEqual(["start", "stop:begin", "stop:end", "start"]);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("unblocks the next start after stopTimeoutMs when stop hangs", async () => {
    vi.useFakeTimers();
    try {
      const start = vi.fn(async () => ({ id: 1 }));
      const stop = vi.fn(() => new Promise<void>(() => {}));
      const singleton = hotSingleton({
        key: uniqueKey(),
        start,
        stop,
        hot: undefined,
        stopTimeoutMs: 1000,
      });

      await singleton.start();
      void singleton.stop();
      const restart = singleton.start();

      await vi.advanceTimersByTimeAsync(1000);
      await restart;

      expect(start).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stop is a no-op when nothing has started", async () => {
    const stop = vi.fn(async () => {});
    const singleton = hotSingleton({
      key: uniqueKey(),
      start: vi.fn(async () => ({ id: 1 })),
      stop,
      hot: undefined,
    });

    await singleton.stop();

    expect(stop).not.toHaveBeenCalled();
  });

  it("wires hot dispose/accept and restarts on reload", async () => {
    const key = uniqueKey();
    const start = vi.fn(async () => ({ id: 1 }));
    const stop = vi.fn(async () => {});

    const hot1 = createMockHot();
    const first = hotSingleton({ key, start, stop, hot: hot1.hot });
    expect(hot1.accepted).toBe(true);
    await first.start();

    // The module is replaced: the old instance is disposed, then a new instance
    // is constructed against the same registry slot and restarts itself.
    hot1.triggerDispose();
    const hot2 = createMockHot();
    hotSingleton({ key, start, stop, hot: hot2.hot });
    await flush();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("routes stop failures to onError", async () => {
    const error = new Error("stop boom");
    const start = vi.fn(async () => ({ id: 1 }));
    const stop = vi.fn(async () => {
      throw error;
    });
    const onError = vi.fn();
    const singleton = hotSingleton({
      key: uniqueKey(),
      start,
      stop,
      hot: undefined,
      onError,
    });

    await singleton.start();
    await singleton.stop();

    expect(onError).toHaveBeenCalledWith(error);
  });
});
