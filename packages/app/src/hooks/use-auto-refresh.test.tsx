import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({ refresh: "5s" }),
  useNavigate: () => vi.fn(),
}));
vi.mock("./use-time-range", () => ({ useRouteTimeDefaults: () => ({}) }));
vi.mock("#app/data/replay/server.ts", () => ({
  getCoveringClips: vi.fn(),
  getClipEvents: vi.fn(),
}));

import { clipEventsOptions } from "#app/data/replay/options.ts";
import { useAutoRefresh } from "./use-auto-refresh";

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutoRefresh", () => {
  it("refreshes the active queries on each tick and on demand, except a Clip's events", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const listFetches = vi.fn(async () => []);
    const clipFetches = vi.fn(async () => ({
      events: [{ type: 4, timestamp: 1, data: {} }],
      gaps: [],
    }));
    const watched = [
      new QueryObserver(queryClient, {
        queryKey: ["runs"],
        queryFn: listFetches,
        staleTime: Number.POSITIVE_INFINITY,
      }),
      new QueryObserver(queryClient, {
        ...clipEventsOptions({ clipId: "clip-1", startMs: 0 }),
        queryFn: clipFetches,
      }),
    ];
    const unsubscribe = watched.map((observer) => observer.subscribe(() => {}));
    await vi.advanceTimersByTimeAsync(0);
    expect(listFetches).toHaveBeenCalledTimes(1);
    expect(clipFetches).toHaveBeenCalledTimes(1);

    const { result } = renderHook(() => useAutoRefresh(), { wrapper });
    await vi.advanceTimersByTimeAsync(5_000);
    await act(async () => result.current.refreshNow());

    expect(listFetches).toHaveBeenCalledTimes(3);
    expect(clipFetches).toHaveBeenCalledTimes(1);
    for (const stop of unsubscribe) stop();
  });

  it("refreshes a Clip's events that came back empty or with gaps, since Segments may still arrive", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const emptyFetches = vi.fn(async () => ({ events: [], gaps: [] }));
    const partialFetches = vi.fn(async () => ({
      events: [{ type: 4, timestamp: 1, data: {} }],
      gaps: [{ kind: "index", streamId: "s", after: 1, missing: 1 }],
    }));
    const watched = [
      new QueryObserver(queryClient, {
        ...clipEventsOptions({ clipId: "clip-empty", startMs: 0 }),
        queryFn: emptyFetches,
      }),
      new QueryObserver(queryClient, {
        ...clipEventsOptions({ clipId: "clip-partial", startMs: 0 }),
        queryFn: partialFetches,
      }),
    ];
    const unsubscribe = watched.map((observer) => observer.subscribe(() => {}));
    await vi.advanceTimersByTimeAsync(0);

    const { result } = renderHook(() => useAutoRefresh(), { wrapper });
    await act(async () => result.current.refreshNow());

    expect(emptyFetches).toHaveBeenCalledTimes(2);
    expect(partialFetches).toHaveBeenCalledTimes(2);
    for (const stop of unsubscribe) stop();
  });
});
