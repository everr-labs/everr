import {
  getTraceOptions,
  TraceDetailParamsSchema,
} from "@everr/telemetry-explorer/traces";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { remoteTracesRepo } from "@/data/traces/remote-repo";
import {
  ensureTraceDetailData,
  getTraceDetailLoaderDeps,
} from "./-trace-detail";

vi.mock("@/data/traces/remote-repo", () => ({
  remoteTracesRepo: { getTrace: vi.fn(async () => []) },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("shares prefetched trace data with the viewer regardless of URL time bounds", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T14:00:00Z"));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  const search = TraceDetailParamsSchema.parse({ from: "now-1h", to: "now" });
  await ensureTraceDetailData({
    queryClient,
    traceId: "trace-1",
    deps: getTraceDetailLoaderDeps(search),
  });
  vi.setSystemTime(new Date(Date.now() + 100));
  const observer = new QueryObserver(
    queryClient,
    getTraceOptions({
      repo: remoteTracesRepo,
      traceId: "trace-1",
      refresh: "off",
    }),
  );
  const unsubscribe = observer.subscribe(() => {});
  try {
    expect(observer.getCurrentResult().data).toEqual([]);
    await ensureTraceDetailData({
      queryClient,
      traceId: "trace-1",
      deps: getTraceDetailLoaderDeps({
        ...search,
        start: "2026-01-01 00:00:00",
        end: "2026-01-01 01:00:00",
      }),
    });
    expect(remoteTracesRepo.getTrace).toHaveBeenCalledExactlyOnceWith({
      traceId: "trace-1",
    });
    await observer.refetch();
    expect(remoteTracesRepo.getTrace).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
    queryClient.clear();
  }
});
