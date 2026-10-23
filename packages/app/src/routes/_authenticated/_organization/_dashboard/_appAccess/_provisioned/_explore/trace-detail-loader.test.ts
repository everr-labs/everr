import { getTraceOptions, TraceDetailParamsSchema } from "@everr/telemetry-explorer/traces";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { consultTrace } from "#app/data/traces/server.ts";
import { remoteTracesRepo } from "#app/data/traces/remote-repo.ts";
import { Route } from "./traces_.$traceId";

vi.mock("#app/data/traces/server.ts", () => ({ consultTrace: vi.fn(async () => []) }));
vi.mock("#app/data/traces/remote-repo.ts", () => ({
  remoteTracesRepo: { getTrace: vi.fn(async () => []) },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("shares consulted trace data and leaves viewer refresh unobserved", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T14:00:00Z"));
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()();
  const load = Route.options.loader;
  if (typeof load !== "function") throw new Error("Expected trace route loader");
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
    expect(consultTrace).toHaveBeenCalledExactlyOnceWith({
      data: {
        traceId: "trace-1",
      },
    });
    await observer.refetch();
    expect(remoteTracesRepo.getTrace).toHaveBeenCalledTimes(1);
    expect(consultTrace).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
    queryClient.clear();
  }
});

it("skips intent preload and consults on the subsequent actual navigation", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()();
  const load = Route.options.loader;
  if (typeof load !== "function") throw new Error("Expected trace route loader");
  const home = createRoute({ getParentRoute: () => root, path: "/" });
  const trace = createRoute({
    getParentRoute: () => root,
    path: "/traces/$traceId",
    validateSearch: TraceDetailParamsSchema,
    preloadStaleTime: Route.options.preloadStaleTime,
    loader: (args) => load(args as unknown as Parameters<typeof load>[0]),
  });
  const router = createRouter({
    routeTree: root.addChildren([home, trace]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
    context: { queryClient },
  });
  await router.load();
  await router.preloadRoute({
    to: "/traces/$traceId",
    params: { traceId: "preloaded-trace" },
    search: {},
  });
  expect(consultTrace).not.toHaveBeenCalled();
  expect(remoteTracesRepo.getTrace).not.toHaveBeenCalled();
  await router.navigate({
    to: "/traces/$traceId",
    params: { traceId: "preloaded-trace" },
    search: {},
  });
  expect(consultTrace).toHaveBeenCalledExactlyOnceWith({
    data: { traceId: "preloaded-trace" },
  });
  queryClient.clear();
});
