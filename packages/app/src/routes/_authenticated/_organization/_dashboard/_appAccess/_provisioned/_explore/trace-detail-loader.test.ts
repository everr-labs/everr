import {
  getTraceOptions,
  TraceDetailParamsSchema,
} from "@everr/telemetry-explorer/traces";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";
import { remoteTracesRepo } from "@/data/traces/remote-repo";
import { Route } from "./traces_.$traceId";

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
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()();
  const load = Route.options.loader;
  if (typeof load !== "function")
    throw new Error("Expected trace route loader");
  const trace = createRoute({
    getParentRoute: () => root,
    path: "/traces/$traceId",
    validateSearch: TraceDetailParamsSchema,
    // The test router omits auth guards; the loader only reads queryClient and params.
    loader: (args) => load(args as unknown as Parameters<typeof load>[0]),
  });
  const router = createRouter({
    routeTree: root.addChildren([trace]),
    history: createMemoryHistory({
      initialEntries: ["/traces/trace-1?from=now-1h&to=now"],
    }),
    context: { queryClient },
  });
  await router.load();
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
    await router.navigate({
      to: "/traces/$traceId",
      params: { traceId: "trace-1" },
      search: {
        start: "2026-01-01 00:00:00",
        end: "2026-01-01 01:00:00",
        refresh: "5s",
      },
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
