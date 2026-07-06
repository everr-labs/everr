import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THROTTLE_MS } from "./realtime-subscription-machine";
import {
  CC_INVALIDATION_DEBOUNCE_MS,
  CC_INVALIDATION_KEYS,
  createCcInvalidationStream,
  createTrailingDebounce,
} from "./use-cc-invalidation";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
}

function latestEs(): MockEventSource {
  return MockEventSource.instances[MockEventSource.instances.length - 1]!;
}

/** A raw CC event carries no `type` field, unlike `{type:"ping"}` heartbeats. */
function sendCcEvent(status: "firing" | "resolved" = "firing") {
  latestEs().onmessage!(
    new MessageEvent("message", {
      data: JSON.stringify({ rule: "r1", instance_key: "k1", status }),
    }),
  );
}

function sendPing() {
  latestEs().onmessage!(
    new MessageEvent("message", { data: JSON.stringify({ type: "ping" }) }),
  );
}

/** Advance past the machine throttle then the trailing debounce so any pending
 * invalidation wave flushes. */
function flush() {
  vi.advanceTimersByTime(THROTTLE_MS);
  vi.advanceTimersByTime(CC_INVALIDATION_DEBOUNCE_MS);
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createTrailingDebounce", () => {
  it("coalesces a burst of triggers into a single call on the trailing edge", () => {
    const fn = vi.fn();
    const d = createTrailingDebounce(fn, 2000);
    d.trigger();
    vi.advanceTimersByTime(1999);
    d.trigger();
    vi.advanceTimersByTime(1999);
    d.trigger();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not fire after cancel", () => {
    const fn = vi.fn();
    const d = createTrailingDebounce(fn, 2000);
    d.trigger();
    d.cancel();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("createCcInvalidationStream", () => {
  function connectStream(invalidate = vi.fn()) {
    const stream = createCcInvalidationStream({
      invalidate,
      EventSourceCtor: MockEventSource as unknown as typeof EventSource,
    });
    stream.connect();
    latestEs().onopen!();
    return { stream, invalidate };
  }

  it("invalidates precisely the CC-affected keys, once per key, after a burst", () => {
    const { invalidate } = connectStream();

    for (let i = 0; i < 5; i++) sendCcEvent();
    // Nothing before the windows elapse.
    expect(invalidate).not.toHaveBeenCalled();

    flush();

    expect(invalidate).toHaveBeenCalledTimes(CC_INVALIDATION_KEYS.length);
    for (const key of CC_INVALIDATION_KEYS) {
      expect(invalidate).toHaveBeenCalledWith(key);
    }
    // The exact set: alerts tree + cc active alerts + cc rule rollups.
    expect(CC_INVALIDATION_KEYS).toEqual([
      ["alerts"],
      ["cc", "alerts"],
      ["cc", "rules"],
    ]);
  });

  it("collapses an event burst into a single invalidation wave", () => {
    const { invalidate } = connectStream();

    for (let i = 0; i < 20; i++) sendCcEvent();
    flush();

    // One wave: exactly one invalidation per key, not one per event.
    expect(invalidate).toHaveBeenCalledTimes(CC_INVALIDATION_KEYS.length);
  });

  it("ignores ping heartbeats", () => {
    const { invalidate } = connectStream();

    sendPing();
    sendPing();
    flush();

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does not invalidate after dispose", () => {
    const { stream, invalidate } = connectStream();

    sendCcEvent();
    stream.dispose();
    flush();

    expect(invalidate).not.toHaveBeenCalled();
    expect(latestEs().close).toHaveBeenCalled();
  });

  it("stops reconnecting after the bounded retry budget (no reconnect loop)", () => {
    connectStream();

    // 5 retries stay within budget, each spawning a fresh EventSource.
    for (let i = 0; i < 5; i++) {
      latestEs().onerror!();
      vi.advanceTimersByTime(30_000);
    }
    // The 6th error disconnects permanently.
    latestEs().onerror!();
    const count = MockEventSource.instances.length;
    vi.advanceTimersByTime(30_000);
    expect(MockEventSource.instances).toHaveLength(count);
  });
});
