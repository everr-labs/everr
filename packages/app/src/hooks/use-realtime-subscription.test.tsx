import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
