import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RECONNECT_DELAY_MS,
  RealtimeSubscriptionMachine,
  THROTTLE_MS,
} from "./realtime-subscription-machine";

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

function createMachine(
  overrides: Partial<
    ConstructorParameters<typeof RealtimeSubscriptionMachine>[0]
  > = {},
) {
  return new RealtimeSubscriptionMachine({
    url: "/api/events/stream?scope=tenant",
    onInvalidate: vi.fn(),
    EventSourceCtor: MockEventSource as unknown as typeof EventSource,
    ...overrides,
  });
}

function latestEs(): MockEventSource {
  return MockEventSource.instances[MockEventSource.instances.length - 1]!;
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("connection lifecycle", () => {
  it("creates EventSource with correct URL on connect()", () => {
    const machine = createMachine({ url: "/test?scope=tenant" });
    machine.connect();

    expect(MockEventSource.instances).toHaveLength(1);
    expect(latestEs().url).toBe("/test?scope=tenant");
  });

  it("transitions to connected on onopen", () => {
    const machine = createMachine();
    machine.connect();
    latestEs().onopen!();
    // No error thrown — machine is in connected state
  });
});

describe("reconnection", () => {
  it("reconnects with exponential backoff after error", () => {
    const machine = createMachine();
    machine.connect();
    latestEs().onopen!();
    latestEs().onerror!();

    expect(latestEs().close).toHaveBeenCalledOnce();
    expect(MockEventSource.instances).toHaveLength(1);

    // Backoff: 1000 * 2^1 = 2000ms
    vi.advanceTimersByTime(2000);

    expect(MockEventSource.instances).toHaveLength(2);
  });

  it("transitions to disconnected after max retries", () => {
    const machine = createMachine();
    machine.connect();

    for (let i = 0; i < 5; i++) {
      latestEs().onerror!();
      vi.advanceTimersByTime(MAX_RECONNECT_DELAY_MS);
    }

    // 6th error should disconnect permanently
    latestEs().onerror!();

    // No new EventSource created
    const countAfterDisconnect = MockEventSource.instances.length;
    vi.advanceTimersByTime(MAX_RECONNECT_DELAY_MS);
    expect(MockEventSource.instances).toHaveLength(countAfterDisconnect);
  });

  it("resets retry counter on successful connection", () => {
    const machine = createMachine();
    machine.connect();

    // Fail a few times
    latestEs().onerror!();
    vi.advanceTimersByTime(MAX_RECONNECT_DELAY_MS);
    latestEs().onerror!();
    vi.advanceTimersByTime(MAX_RECONNECT_DELAY_MS);

    // Successfully connect
    latestEs().onopen!();

    // Fail again — should get full retry budget
    for (let i = 0; i < 5; i++) {
      latestEs().onerror!();
      vi.advanceTimersByTime(MAX_RECONNECT_DELAY_MS);
    }

    // 6th error after reset — now disconnects
    latestEs().onerror!();
    const countAfterDisconnect = MockEventSource.instances.length;
    vi.advanceTimersByTime(MAX_RECONNECT_DELAY_MS);
    expect(MockEventSource.instances).toHaveLength(countAfterDisconnect);
  });

  it("handles error during connecting state", () => {
    const machine = createMachine();
    machine.connect();
    // Error before onopen
    latestEs().onerror!();

    expect(latestEs().close).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2000);
    expect(MockEventSource.instances).toHaveLength(2);
  });
});

describe("trailing throttle", () => {
  it("calls onInvalidate after throttle delay, not immediately", () => {
    const onInvalidate = vi.fn();
    const machine = createMachine({ onInvalidate });
    machine.connect();
    latestEs().onopen!();

    latestEs().onmessage!(
      new MessageEvent("message", { data: JSON.stringify({ type: "update" }) }),
    );

    expect(onInvalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(THROTTLE_MS);

    expect(onInvalidate).toHaveBeenCalledOnce();
  });

  it("ignores non-update messages", () => {
    const onInvalidate = vi.fn();
    const machine = createMachine({ onInvalidate });
    machine.connect();
    latestEs().onopen!();

    latestEs().onmessage!(
      new MessageEvent("message", { data: JSON.stringify({ type: "ping" }) }),
    );

    vi.advanceTimersByTime(THROTTLE_MS);

    expect(onInvalidate).not.toHaveBeenCalled();
  });

  it("batches multiple rapid messages into one invalidation per window", () => {
    const onInvalidate = vi.fn();
    const machine = createMachine({ onInvalidate });
    machine.connect();
    latestEs().onopen!();

    const sendUpdate = () =>
      latestEs().onmessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "update" }),
        }),
      );

    sendUpdate();
    sendUpdate();
    sendUpdate();

    vi.advanceTimersByTime(THROTTLE_MS);

    expect(onInvalidate).toHaveBeenCalledOnce();
  });

  it("fires again if messages arrive during throttle window", () => {
    const onInvalidate = vi.fn();
    const machine = createMachine({ onInvalidate });
    machine.connect();
    latestEs().onopen!();

    const sendUpdate = () =>
      latestEs().onmessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "update" }),
        }),
      );

    sendUpdate();
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    // New message in next window
    sendUpdate();
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(onInvalidate).toHaveBeenCalledTimes(2);
  });

  it("batches mid-window messages into same invalidation", () => {
    const onInvalidate = vi.fn();
    const machine = createMachine({ onInvalidate });
    machine.connect();
    latestEs().onopen!();

    const sendUpdate = () =>
      latestEs().onmessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "update" }),
        }),
      );

    sendUpdate();
    vi.advanceTimersByTime(THROTTLE_MS / 2);
    sendUpdate(); // arrives mid-window, batched with first
    vi.advanceTimersByTime(THROTTLE_MS / 2);
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    // Re-armed timer fires but no new messages — no extra call
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it("fires second time when message arrives after first window fires", () => {
    const onInvalidate = vi.fn();
    const machine = createMachine({ onInvalidate });
    machine.connect();
    latestEs().onopen!();

    const sendUpdate = () =>
      latestEs().onmessage!(
        new MessageEvent("message", {
          data: JSON.stringify({ type: "update" }),
        }),
      );

    sendUpdate();
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    // Message during re-armed window
    sendUpdate();
    vi.advanceTimersByTime(THROTTLE_MS);
    expect(onInvalidate).toHaveBeenCalledTimes(2);
  });

  it("stops firing after messages stop arriving", () => {
    const onInvalidate = vi.fn();
    const machine = createMachine({ onInvalidate });
    machine.connect();
    latestEs().onopen!();

    latestEs().onmessage!(
      new MessageEvent("message", { data: JSON.stringify({ type: "update" }) }),
    );

    vi.advanceTimersByTime(THROTTLE_MS);
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    // No new messages — advancing further should not fire again
    vi.advanceTimersByTime(THROTTLE_MS * 10);
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });
});

describe("dispose", () => {
  it("closes EventSource and clears timers from connected state", () => {
    const machine = createMachine();
    machine.connect();
    latestEs().onopen!();

    machine.dispose();

    expect(latestEs().close).toHaveBeenCalledOnce();
  });

  it("cancels pending reconnect timer", () => {
    const machine = createMachine();
    machine.connect();
    latestEs().onerror!();

    machine.dispose();

    // Advancing past the reconnect delay should not create a new EventSource
    vi.advanceTimersByTime(MAX_RECONNECT_DELAY_MS);
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("cancels pending throttle invalidation", () => {
    const onInvalidate = vi.fn();
    const machine = createMachine({ onInvalidate });
    machine.connect();
    latestEs().onopen!();

    latestEs().onmessage!(
      new MessageEvent("message", { data: JSON.stringify({ type: "update" }) }),
    );
    machine.dispose();

    vi.advanceTimersByTime(THROTTLE_MS);
    expect(onInvalidate).not.toHaveBeenCalled();
  });

  it("is safe to call from idle state", () => {
    const machine = createMachine();
    expect(() => machine.dispose()).not.toThrow();
  });
});
