import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouteMask,
  createRouter,
} from "@tanstack/react-router";
import { beforeEach, expect, test } from "vitest";

// On the server, router-core caches the processed route tree on
// `globalThis.__TSR_CACHE__`, keyed only by route tree identity, so the first
// router built over a tree wins for the life of the process. The telemetry
// matcher in `server-router.ts` is built during the first request, before the
// SSR router, so it is the one that seeds the cache.
//
// A router built without `routeMasks` seeds a tree whose mask cache is null.
// A later router that does set `routeMasks` inherits that tree and throws
// "Cannot read properties of null (reading 'get')" inside findFlatMatch as
// soon as it builds a location. Both routers must therefore pass the masks.

function buildTree() {
  const rootRoute = createRootRoute();
  const tracesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/traces",
  });
  const traceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/traces/$traceId",
  });
  const modalRoute = createRoute({
    getParentRoute: () => tracesRoute,
    path: "$traceId/modal",
  });
  const routeTree = rootRoute.addChildren([
    traceRoute,
    tracesRoute.addChildren([modalRoute]),
  ]);
  const masks = [
    createRouteMask({
      routeTree,
      from: "/traces/$traceId/modal",
      to: "/traces/$traceId",
      params: true,
      search: true,
      unmaskOnReload: true,
    }),
  ];
  return { routeTree, masks };
}

beforeEach(() => {
  globalThis.__TSR_CACHE__ = undefined;
});

test("a masked SSR router survives a matcher seeding the server tree cache", () => {
  const { routeTree, masks } = buildTree();

  // First request: the telemetry matcher builds and seeds __TSR_CACHE__.
  createRouter({
    routeTree,
    routeMasks: masks,
    isServer: true,
    history: createMemoryHistory({ initialEntries: ["/traces"] }),
  });
  expect(globalThis.__TSR_CACHE__).toBeDefined();

  // Same request, moments later: the SSR router reuses the cached tree.
  const ssr = createRouter({
    routeTree,
    routeMasks: masks,
    isServer: true,
    history: createMemoryHistory({ initialEntries: ["/traces"] }),
  });

  expect(() => ssr.buildLocation({ to: "/traces" })).not.toThrow();
});
