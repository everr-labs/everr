import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THROTTLE_MS } from "./realtime-subscription-machine";
import { useRealtimeSubscription } from "./use-realtime-subscription";

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

vi.stubGlobal("EventSource", MockEventSource);

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function createWrapper(queryClient = createQueryClient()) {
  return function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const Wrapper = createWrapper();
  return <Wrapper>{children}</Wrapper>;
}

function latestEs(): MockEventSource {
  const eventSource =
    MockEventSource.instances[MockEventSource.instances.length - 1];
  if (!eventSource) throw new Error("Expected an EventSource instance");
  return eventSource;
}

function sendUpdate() {
  latestEs().onopen?.();
  latestEs().onmessage?.(
    new MessageEvent("message", { data: JSON.stringify({ type: "update" }) }),
  );
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useRealtimeSubscription — tenant scope", () => {
  it("opens EventSource with scope=tenant", () => {
    renderHook(() => useRealtimeSubscription({ scope: "tenant" }), { wrapper });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.url).toContain("scope=tenant");
  });

  it("closes EventSource on unmount", () => {
    const { unmount } = renderHook(
      () => useRealtimeSubscription({ scope: "tenant" }),
      { wrapper },
    );

    unmount();

    expect(MockEventSource.instances[0]?.close).toHaveBeenCalledOnce();
  });

  it("invalidates runs and errors queries on tenant updates", () => {
    vi.useFakeTimers();
    const queryClient = createQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useRealtimeSubscription({ scope: "tenant" }), {
      wrapper: createWrapper(queryClient),
    });
    sendUpdate();

    act(() => {
      vi.advanceTimersByTime(THROTTLE_MS);
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["runs"] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["errors"] });
  });
});

describe("useRealtimeSubscription — trace scope", () => {
  it("opens EventSource with scope=trace and traceId", () => {
    renderHook(
      () => useRealtimeSubscription({ scope: "trace", traceId: "abc123" }),
      { wrapper },
    );

    const url = MockEventSource.instances[0]?.url ?? "";
    expect(url).toContain("scope=trace");
    expect(url).toContain("key=abc123");
  });

  it("closes EventSource on unmount", () => {
    const { unmount } = renderHook(
      () => useRealtimeSubscription({ scope: "trace", traceId: "abc123" }),
      { wrapper },
    );

    unmount();

    expect(MockEventSource.instances[0]?.close).toHaveBeenCalledOnce();
  });
});
