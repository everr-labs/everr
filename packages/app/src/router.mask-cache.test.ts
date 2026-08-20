// Node environment so `this.isServer` is true and the router takes the caching
// path this test is about.
// @vitest-environment node
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router";
import { beforeEach, expect, test, vi } from "vitest";

// Stub the generated tree: the real one pulls every route module (and the
// server env, ClickHouse, and server functions with it) into the test. The
// subject stays the real `getRouter`, with its real masks and mode branch.
vi.mock("./routeTree.gen", () => {
  const rootRoute = createRootRoute();
  return {
    routeTree: rootRoute.addChildren(
      [
        "/traces",
        "/traces/$traceId",
        "/traces/$traceId/modal",
        "/errors/$fingerprint",
        "/errors/$fingerprint/modal",
      ].map((path) => createRoute({ getParentRoute: () => rootRoute, path })),
    ),
  };
});

import { getRouter } from "./router";

// Start hands the rendering router the request's history before using it, so
// do the same rather than exercising a shape production never sees.
function renderingRouter() {
  const router = getRouter();
  router.update({
    ...router.options,
    history: createMemoryHistory({ initialEntries: ["/traces"] }),
  });
  return router;
}

// Whichever router is built first seeds the process-wide route tree cache, so
// a mismatch between the two modes crashes the other one. See `getRouter`.
// Production builds the matcher first; both orders are covered so neither mode
// can drift from the other.
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
