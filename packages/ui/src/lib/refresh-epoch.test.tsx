import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { usePageRefresh } from "./refresh-epoch";

afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
});

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

function renderPageRefresh(refresh: string) {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const result = renderHook(() => usePageRefresh(refresh), { wrapper });
  return { ...result, invalidate };
}

describe("usePageRefresh", () => {
  it("keeps its interval across renders", () => {
    const { rerender, invalidate } = renderPageRefresh("10s");
    vi.advanceTimersByTime(6_000);
    rerender();
    vi.advanceTimersByTime(4_000);

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("waits until a hidden tab is shown again to refresh, once", () => {
    const { invalidate } = renderPageRefresh("10s");
    setHidden(true);
    vi.advanceTimersByTime(30_000);
    expect(invalidate).not.toHaveBeenCalled();

    setHidden(false);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("doesn't refresh when a tab is shown again before an interval has passed", () => {
    const { invalidate } = renderPageRefresh("10s");
    setHidden(true);
    vi.advanceTimersByTime(5_000);
    setHidden(false);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("doesn't refresh when a tab is shown again with auto-refresh off", () => {
    const { invalidate } = renderPageRefresh("off");
    setHidden(true);
    vi.advanceTimersByTime(60_000);
    setHidden(false);

    expect(invalidate).not.toHaveBeenCalled();
  });
});
