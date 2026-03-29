import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchResponse } from "@/data/watch";
import { WatchMachine } from "./-watch-machine";

const THROTTLE_MS = 300;

function createMachine(
  overrides: Partial<ConstructorParameters<typeof WatchMachine>[0]> = {},
) {
  const unsubscribe = vi.fn();
  const subscribe = vi.fn<(onNotify: () => void) => () => void>(
    () => unsubscribe,
  );
  const opts = {
    fetchStatus: vi.fn<() => Promise<WatchResponse>>().mockResolvedValue({
      state: "running" as const,
      active: [],
      completed: [],
    }),
    sendEvent: vi.fn(),
    subscribe,
    close: vi.fn(),
    ...overrides,
  };
  const machine = new WatchMachine(opts);
  return { machine, opts, subscribe, unsubscribe };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("subscription lifecycle", () => {
  it("calls subscribe on start()", () => {
    const { machine, opts } = createMachine();
    machine.start();
    expect(opts.subscribe).toHaveBeenCalledOnce();
  });

  it("does not fetch on start()", () => {
    const { machine, opts } = createMachine();
    machine.start();
    expect(opts.fetchStatus).not.toHaveBeenCalled();
  });

  it("unsubscribes and closes on dispose()", () => {
    const { machine, opts, unsubscribe } = createMachine();
    machine.start();
    machine.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(opts.close).toHaveBeenCalledOnce();
  });

  it("is safe to call dispose() from idle", () => {
    const { machine } = createMachine();
    expect(() => machine.dispose()).not.toThrow();
  });
});

describe("trailing throttle", () => {
  it("does not fetch immediately on NOTIFY", () => {
    const { machine, opts, subscribe } = createMachine();
    machine.start();

    const onNotify = subscribe.mock.calls[0][0];
    onNotify();

    expect(opts.fetchStatus).not.toHaveBeenCalled();
  });

  it("fetches after throttle delay", async () => {
    const { machine, opts, subscribe } = createMachine();
    machine.start();

    const onNotify = subscribe.mock.calls[0][0];
    onNotify();

    vi.advanceTimersByTime(THROTTLE_MS);

    expect(opts.fetchStatus).toHaveBeenCalledOnce();
  });

  it("batches multiple notifications into one fetch", () => {
    const { machine, opts, subscribe } = createMachine();
    machine.start();

    const onNotify = subscribe.mock.calls[0][0];
    onNotify();
    onNotify();
    onNotify();

    vi.advanceTimersByTime(THROTTLE_MS);

    expect(opts.fetchStatus).toHaveBeenCalledOnce();
  });

  it("does not fire extra fetch after notifications stop", async () => {
    const { machine, opts, subscribe } = createMachine();
    machine.start();

    const onNotify = subscribe.mock.calls[0][0];
    onNotify();

    vi.advanceTimersByTime(THROTTLE_MS);
    await vi.advanceTimersByTimeAsync(0); // flush promise

    expect(opts.fetchStatus).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(THROTTLE_MS * 10);
    expect(opts.fetchStatus).toHaveBeenCalledOnce();
  });
});

describe("fetch cycle", () => {
  it("sends event on successful fetch with running state", async () => {
    const result: WatchResponse = {
      state: "running",
      active: [],
      completed: [],
    };
    const { machine, opts, subscribe } = createMachine({
      fetchStatus: vi.fn().mockResolvedValue(result),
    });
    machine.start();

    const onNotify = subscribe.mock.calls[0][0];
    onNotify();
    vi.advanceTimersByTime(THROTTLE_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(opts.sendEvent).toHaveBeenCalledWith(result);
  });

  it("auto-closes on completed state", async () => {
    const result: WatchResponse = {
      state: "completed",
      active: [],
      completed: [],
    };
    const { machine, opts, subscribe, unsubscribe } = createMachine({
      fetchStatus: vi.fn().mockResolvedValue(result),
    });
    machine.start();

    const onNotify = subscribe.mock.calls[0][0];
    onNotify();
    vi.advanceTimersByTime(THROTTLE_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(opts.sendEvent).toHaveBeenCalledWith(result);
    expect(opts.close).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("starts new throttle cycle when notify arrives during fetch", async () => {
    let resolvePromise: (value: WatchResponse) => void;
    const fetchStatus = vi.fn().mockImplementation(
      () =>
        new Promise<WatchResponse>((resolve) => {
          resolvePromise = resolve;
        }),
    );
    const { machine, opts, subscribe } = createMachine({ fetchStatus });
    machine.start();

    const onNotify = subscribe.mock.calls[0][0];
    onNotify();
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    // Notify arrives during fetch
    onNotify();

    // Resolve first fetch
    resolvePromise!({ state: "running", active: [], completed: [] });
    await vi.advanceTimersByTimeAsync(0);

    expect(opts.sendEvent).toHaveBeenCalledTimes(1);

    // New throttle cycle should start
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("returns to listening on fetch error", async () => {
    const fetchStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("db error"))
      .mockResolvedValueOnce({ state: "running", active: [], completed: [] });
    const { machine, opts, subscribe } = createMachine({ fetchStatus });
    machine.start();

    const onNotify = subscribe.mock.calls[0][0];
    onNotify();
    vi.advanceTimersByTime(THROTTLE_MS);
    await vi.advanceTimersByTimeAsync(0); // flush rejected promise

    expect(opts.sendEvent).not.toHaveBeenCalled();

    // Should be back in listening — new notify works
    onNotify();
    vi.advanceTimersByTime(THROTTLE_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(opts.sendEvent).toHaveBeenCalledOnce();
  });
});

describe("dispose edge cases", () => {
  it("cancels throttle timer on dispose", () => {
    const { machine, opts, subscribe } = createMachine();
    machine.start();

    const onNotify = subscribe.mock.calls[0][0];
    onNotify();

    machine.dispose();

    vi.advanceTimersByTime(THROTTLE_MS);
    expect(opts.fetchStatus).not.toHaveBeenCalled();
  });

  it("prevents sending result when disposed during fetch", async () => {
    let resolvePromise: (value: WatchResponse) => void;
    const fetchStatus = vi.fn().mockImplementation(
      () =>
        new Promise<WatchResponse>((resolve) => {
          resolvePromise = resolve;
        }),
    );
    const { machine, opts, subscribe } = createMachine({ fetchStatus });
    machine.start();

    const onNotify = subscribe.mock.calls[0][0];
    onNotify();
    vi.advanceTimersByTime(THROTTLE_MS);

    machine.dispose();

    resolvePromise!({ state: "running", active: [], completed: [] });
    await vi.advanceTimersByTimeAsync(0);

    expect(opts.sendEvent).not.toHaveBeenCalled();
    expect(opts.close).toHaveBeenCalledOnce();
  });
});
