import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { refreshPage, usePageRefresh, useRefreshInstant } from "./refresh-epoch";

afterEach(() => {
  vi.useRealTimers();
});

describe("usePageRefresh", () => {
  it("keeps its interval across renders", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { rerender } = renderHook(() => usePageRefresh("10s"), { wrapper });
    vi.advanceTimersByTime(6_000);
    rerender();
    vi.advanceTimersByTime(4_000);

    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

describe("useRefreshInstant", () => {
  it("takes a new instant on every refresh and range change", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000);
    const client = new QueryClient();
    vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    const { result, rerender } = renderHook(({ range }) => useRefreshInstant(range), {
      initialProps: { range: "last 15m" },
    });
    expect(result.current.at).toBe(1_000);

    vi.setSystemTime(2_000);
    rerender({ range: "last 15m" });
    expect(result.current.at).toBe(1_000);

    act(() => refreshPage(client));
    expect(result.current.at).toBe(2_000);

    vi.setSystemTime(3_000);
    act(() => refreshPage(client));
    expect(result.current.at).toBe(3_000);

    vi.setSystemTime(4_000);
    rerender({ range: "last 1h" });
    expect(result.current.at).toBe(4_000);
  });
});
