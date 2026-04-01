import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FailureNotification } from "@/routes/api/cli/-failure-notifications";
import { FailureStreamMachine } from "./-stream-machine";

const THROTTLE_MS = 300;

function makeNotification(dedupeKey: string): FailureNotification {
  return {
    dedupeKey,
    traceId: `trace-${dedupeKey}`,
    repo: "org/repo",
    branch: "main",
    workflowName: "CI",
    failedAt: "2026-04-01T10:00:00Z",
    detailsUrl: "https://example.com",
  };
}

function createMachine(
  overrides: Partial<
    ConstructorParameters<typeof FailureStreamMachine>[0]
  > = {},
) {
  const unsubscribe = vi.fn();
  const subscribe = vi.fn<(onNotify: () => void) => () => void>(
    () => unsubscribe,
  );
  const opts = {
    fetchFailures: vi
      .fn<() => Promise<FailureNotification[]>>()
      .mockResolvedValue([]),
    sendEvent: vi.fn(),
    subscribe,
    ...overrides,
  };
  const machine = new FailureStreamMachine(opts);
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

  it("unsubscribes on dispose()", () => {
    const { machine, unsubscribe } = createMachine();
    machine.start();
    machine.dispose();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("is safe to call dispose() from idle", () => {
    const { machine } = createMachine();
    expect(() => machine.dispose()).not.toThrow();
  });
});

describe("throttle and fetch", () => {
  it("does not fetch immediately on notify", () => {
    const { machine, opts, subscribe } = createMachine();
    machine.start();
    subscribe.mock.calls[0][0]();
    expect(opts.fetchFailures).not.toHaveBeenCalled();
  });

  it("fetches after throttle delay", () => {
    const { machine, opts, subscribe } = createMachine();
    machine.start();
    subscribe.mock.calls[0][0]();
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(opts.fetchFailures).toHaveBeenCalledOnce();
  });

  it("batches rapid notifications into one fetch", () => {
    const { machine, opts, subscribe } = createMachine();
    machine.start();
    const onNotify = subscribe.mock.calls[0][0];
    onNotify();
    onNotify();
    onNotify();
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(opts.fetchFailures).toHaveBeenCalledOnce();
  });
});

describe("dedup and send", () => {
  it("sends new failures via sendEvent", async () => {
    const n1 = makeNotification("key-1");
    const { machine, opts, subscribe } = createMachine({
      fetchFailures: vi.fn().mockResolvedValue([n1]),
    });
    machine.start();
    subscribe.mock.calls[0][0]();
    vi.advanceTimersByTime(THROTTLE_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(opts.sendEvent).toHaveBeenCalledWith({ failures: [n1] });
  });

  it("does not re-send already-sent failures", async () => {
    const n1 = makeNotification("key-1");
    const fetchFailures = vi.fn().mockResolvedValue([n1]);
    const { machine, opts, subscribe } = createMachine({ fetchFailures });
    machine.start();
    const onNotify = subscribe.mock.calls[0][0];

    // First cycle
    onNotify();
    vi.advanceTimersByTime(THROTTLE_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(opts.sendEvent).toHaveBeenCalledTimes(1);

    // Second cycle — same notification
    onNotify();
    vi.advanceTimersByTime(THROTTLE_MS);
    await vi.advanceTimersByTimeAsync(0);

    // sendEvent should not be called again (no new failures)
    expect(opts.sendEvent).toHaveBeenCalledTimes(1);
  });

  it("sends only the new failures when mixed with already-sent ones", async () => {
    const n1 = makeNotification("key-1");
    const n2 = makeNotification("key-2");
    const fetchFailures = vi
      .fn()
      .mockResolvedValueOnce([n1])
      .mockResolvedValueOnce([n1, n2]);
    const { machine, opts, subscribe } = createMachine({ fetchFailures });
    machine.start();
    const onNotify = subscribe.mock.calls[0][0];

    // First cycle
    onNotify();
    vi.advanceTimersByTime(THROTTLE_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(opts.sendEvent).toHaveBeenCalledWith({ failures: [n1] });

    // Second cycle
    onNotify();
    vi.advanceTimersByTime(THROTTLE_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(opts.sendEvent).toHaveBeenCalledWith({ failures: [n2] });
  });

  it("does not send if fetch returns empty", async () => {
    const { machine, opts, subscribe } = createMachine({
      fetchFailures: vi.fn().mockResolvedValue([]),
    });
    machine.start();
    subscribe.mock.calls[0][0]();
    vi.advanceTimersByTime(THROTTLE_MS);
    await vi.advanceTimersByTimeAsync(0);

    expect(opts.sendEvent).not.toHaveBeenCalled();
  });
});

describe("backfill", () => {
  it("sendBackfill sends current failures and tracks their dedupe keys", async () => {
    const n1 = makeNotification("key-1");
    const { machine, opts } = createMachine({
      fetchFailures: vi.fn().mockResolvedValue([n1]),
    });

    await machine.sendBackfill();

    expect(opts.fetchFailures).toHaveBeenCalledOnce();
    expect(opts.sendEvent).toHaveBeenCalledWith({ failures: [n1] });
  });

  it("sendBackfill does not send if no failures", async () => {
    const { machine, opts } = createMachine({
      fetchFailures: vi.fn().mockResolvedValue([]),
    });

    await machine.sendBackfill();

    expect(opts.sendEvent).not.toHaveBeenCalled();
  });
});

describe("error handling", () => {
  it("returns to listening on fetch error", async () => {
    const n1 = makeNotification("key-1");
    const fetchFailures = vi
      .fn()
      .mockRejectedValueOnce(new Error("db error"))
      .mockResolvedValueOnce([n1]);
    const { machine, opts, subscribe } = createMachine({ fetchFailures });
    machine.start();
    const onNotify = subscribe.mock.calls[0][0];

    // First cycle — error
    onNotify();
    vi.advanceTimersByTime(THROTTLE_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(opts.sendEvent).not.toHaveBeenCalled();

    // Second cycle — success
    onNotify();
    vi.advanceTimersByTime(THROTTLE_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(opts.sendEvent).toHaveBeenCalledWith({ failures: [n1] });
  });
});

describe("dispose edge cases", () => {
  it("cancels throttle timer on dispose", () => {
    const { machine, opts, subscribe } = createMachine();
    machine.start();
    subscribe.mock.calls[0][0]();
    machine.dispose();
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(opts.fetchFailures).not.toHaveBeenCalled();
  });

  it("prevents sending when disposed during fetch", async () => {
    let resolvePromise: (value: FailureNotification[]) => void;
    const fetchFailures = vi.fn().mockImplementation(
      () =>
        new Promise<FailureNotification[]>((resolve) => {
          resolvePromise = resolve;
        }),
    );
    const { machine, opts, subscribe } = createMachine({ fetchFailures });
    machine.start();
    subscribe.mock.calls[0][0]();
    vi.advanceTimersByTime(THROTTLE_MS);

    machine.dispose();

    resolvePromise!([makeNotification("key-1")]);
    await vi.advanceTimersByTimeAsync(0);

    expect(opts.sendEvent).not.toHaveBeenCalled();
  });
});
