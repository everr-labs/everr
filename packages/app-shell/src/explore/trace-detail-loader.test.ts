import { getTraceOptions } from "@everr/telemetry-explorer/traces";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createContractRouter } from "../contract/router";
import { fakeExploreBackend } from "../testing/backend";

afterEach(() => {
  vi.useRealTimers();
});

it("shares prefetched trace data with the viewer regardless of URL time bounds", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T14:00:00Z"));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  const getTrace = vi.fn(async () => []);
  const explore = fakeExploreBackend({ repos: { traces: { getTrace } } });
  const router = createContractRouter("/traces/trace-1?from=now-1h&to=now", {
    queryClient,
    explore,
  });
  await router.load();
  vi.setSystemTime(new Date(Date.now() + 100));
  const observer = new QueryObserver(
    queryClient,
    getTraceOptions({
      repo: explore.repos.traces,
      traceId: "trace-1",
    }),
  );
  const unsubscribe = observer.subscribe(() => {});
  try {
    expect(observer.getCurrentResult().data).toEqual([]);
    await router.navigate({
      to: "/traces/$traceId",
      params: { traceId: "trace-1" },
      search: {
        start: "2026-01-01 00:00:00",
        end: "2026-01-01 01:00:00",
      },
    });
    expect(getTrace).toHaveBeenCalledExactlyOnceWith({
      traceId: "trace-1",
    });
    await observer.refetch();
    expect(getTrace).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
    queryClient.clear();
  }
});
