// @vitest-environment node
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router";
import { beforeEach, expect, test, vi } from "vitest";

// Stub the generated tree rather than importing it: the real one pulls every
// route module (and the server env, ClickHouse, and server functions with it)
// into the test. This keeps the subject the real `getRouter`, including the
// real masks and the real `forRouteMatchingOnly` branch, over a tree that
// carries just the paths those masks name.
vi.mock("./routeTree.gen", () => {
  const rootRoute = createRootRoute();
  const traces = createRoute({
    getParentRoute: () => rootRoute,
    path: "/traces",
  });
  const errors = createRoute({
    getParentRoute: () => rootRoute,
    path: "/errors",
  });
  return {
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/traces/$traceId",
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/errors/$fingerprint",
      }),
      traces.addChildren([
        createRoute({ getParentRoute: () => traces, path: "$traceId/modal" }),
      ]),
      errors.addChildren([
        createRoute({
          getParentRoute: () => errors,
          path: "$fingerprint/modal",
        }),
      ]),
    ]),
  };
});

import { getRouter } from "./router";

// Start hands the rendering router the request's history before using it, so
// do the same here rather than exercising a shape production never sees.
function renderingRouter() {
  const router = getRouter();
  router.update({
    ...router.options,
    history: createMemoryHistory({ initialEntries: ["/traces"] }),
  });
  return router;
}

// The server caches the processed route tree on `globalThis.__TSR_CACHE__`,
// keyed only by route tree identity and blind to the options that decide how
// the tree is processed. The first router built over the tree wins for the
// whole process, so a router configured differently inherits a tree that does
// not match its own options and throws "Cannot read properties of null
// (reading 'get')" from `findFlatMatch` on its first `buildLocation`.
//
// In production the matcher is built first, from `instrumentServerFetch`,
// ahead of the router Start builds to render. Both orders are covered so
// neither mode of `getRouter` can drift from the other.
//
// Node environment: `this.isServer` has to be true for the router to take the
// caching path at all.

beforeEach(() => {
  globalThis.__TSR_CACHE__ = undefined;
});

test("matcher first, then the rendering router", () => {
  getRouter({ forRouteMatchingOnly: true });
  // Guards against passing for the wrong reason: if the environment stops
  // exercising the cache, there is no bug left to reproduce.
  expect(globalThis.__TSR_CACHE__).toBeDefined();

  const router = renderingRouter();
  expect(() => router.buildLocation({ to: "/traces" })).not.toThrow();
});

test("rendering router first, then the matcher", () => {
  const router = renderingRouter();
  expect(globalThis.__TSR_CACHE__).toBeDefined();

  const matcher = getRouter({ forRouteMatchingOnly: true });
  expect(() => matcher.buildLocation({ to: "/traces" })).not.toThrow();
  expect(() => router.buildLocation({ to: "/traces" })).not.toThrow();
});

test("the matcher resolves route templates without a query client", () => {
  const matcher = getRouter({ forRouteMatchingOnly: true });
  expect(matcher.matchRoutes("/traces").at(-1)?.fullPath).toBe("/traces");
  expect(matcher.options.context.queryClient).toBeUndefined();
});
