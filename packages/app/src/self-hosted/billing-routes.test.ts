import {
  createFileRoute,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { expect, it, vi } from "vitest";

// Exercise the generated topology without loading unrelated page dependencies.
for (const path of Object.keys(
  import.meta.glob(["../routes/**/*.{ts,tsx}", "../app/routes/**/*.{ts,tsx}"]),
)) {
  vi.doMock(path, () => ({
    Route:
      path === "../routes/__root.tsx"
        ? createRootRoute()
        : createFileRoute()({}),
  }));
}
const { routeTree } = await import("@app/route-tree");
const router = createRouter({
  routeTree,
  history: createMemoryHistory(),
});

it.each([
  "/choose-organization",
  "/create-organization",
  "/billing",
  "/billing/suspended",
  "/checkout/success",
  "/organizations/checkout/success",
])("does not register the cloud route %s", (path) => {
  expect(
    Object.values(router.routesById).some((route) => route.fullPath === path),
  ).toBe(false);
});

it.each([
  "/access-required",
  "/setup",
])("keeps the product route %s", (path) => {
  expect(
    Object.values(router.routesById).some((route) => route.fullPath === path),
  ).toBe(true);
});
