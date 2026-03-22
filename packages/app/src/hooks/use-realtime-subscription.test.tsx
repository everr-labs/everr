import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRealtimeSubscription } from "./use-realtime-subscription";

type EventSourceListener = (event: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: EventSourceListener | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  emit(data: object) {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }
}

vi.stubGlobal("EventSource", MockEventSource);

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("ignores ping events without throwing", () => {
    renderHook(() => useRealtimeSubscription({ scope: "tenant" }), { wrapper });

    const es = MockEventSource.instances[0];
    expect(es).toBeDefined();
    expect(() => es?.emit({ type: "ping" })).not.toThrow();
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
    expect(url).toContain("traceId=abc123");
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
