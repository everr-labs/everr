import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { useDistinctQueries } from "./use-distinct-queries";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

describe("useDistinctQueries", () => {
  it("fetches a key shared by several options once, for each of them", async () => {
    const fetch = vi.fn(async () => "cpu");
    const option = (enabled: boolean) => ({ queryKey: ["cpu"], queryFn: fetch, enabled });
    const { result } = renderHook(() => useDistinctQueries([option(false), option(true)]), {
      wrapper,
    });

    await waitFor(() => expect(result.current.map((r) => r.data)).toEqual(["cpu", "cpu"]));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
