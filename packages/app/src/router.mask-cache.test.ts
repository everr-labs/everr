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

// The first router built on the server seeds a process-wide cache of the
// processed route tree, and later ones reuse it. Telemetry builds one to
// resolve http.route and Start builds one per request to render, so `getRouter`
// runs more than once per process and every one after the first takes the
// cached path. See `getRouter`.
beforeEach(() => {
  globalThis.__TSR_CACHE__ = undefined;
});

test("a second router can still build a location off the cached tree", () => {
  getRouter();
  // Guards against passing for the wrong reason: if the environment stops
  // exercising the cache, there is no bug left to reproduce.
  expect(globalThis.__TSR_CACHE__).toBeDefined();

  const router = renderingRouter();
  expect(() => router.buildLocation({ to: "/traces" })).not.toThrow();
});

test("a second router can still match routes off the cached tree", () => {
  renderingRouter();
  expect(globalThis.__TSR_CACHE__).toBeDefined();

  const matcher = getRouter();
  expect(matcher.matchRoutes("/traces").at(-1)?.fullPath).toBe("/traces");
});
