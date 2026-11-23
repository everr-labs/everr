import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { usePageRefresh } from "./refresh-epoch";

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
