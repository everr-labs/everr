import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Route as PreviewableLayoutFileRoute } from "./_previewable";

// Two bare leaf routes under the real layout: one leaves `hidePreviewFrame`
// unset (the default, opt-out shape), the other sets it `true` the way
// silences/notifications/routing do because they show live operational state,
// not an as-code resource a preview branch could overlay.
//
// The layout reads its own `Route.id` (from the imported file, not a stub) to
// scope `useMatches()` to routes under itself. That id is only resolved once
// the route is `.init()`-ed inside a real parent chain, which is what file
// generation does for the app router. So this harness attaches the real
// imported `Route` singleton into the tree (via the same `.update()` the
// generator calls) instead of handing its component to a fresh stand-in
// route: a stand-in would carry its own id, and `Route.id` inside the
// component would stay unresolved.
function renderPreviewableLayout(initialEntry: string) {
  const rootRoute = createRootRoute({ component: Outlet });
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_authenticated",
    component: Outlet,
  });
  const dashboardRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    id: "_dashboard",
    component: Outlet,
  });
  // `id` isn't in `.update()`'s public type: only the generator is meant to set
  // it, and routeTree.gen.ts casts for the same reason.
  PreviewableLayoutFileRoute.update({
    id: "/_previewable",
    getParentRoute: () => dashboardRoute,
  } as Parameters<typeof PreviewableLayoutFileRoute.update>[0]);
  const asCodeRoute = createRoute({
    getParentRoute: () => PreviewableLayoutFileRoute,
    path: "as-code",
    component: () => <div>as-code page</div>,
  });
  const liveStateRoute = createRoute({
    getParentRoute: () => PreviewableLayoutFileRoute,
    path: "live-state",
    staticData: { hidePreviewFrame: true },
    component: () => <div>live-state page</div>,
  });
  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([
        PreviewableLayoutFileRoute.addChildren([asCodeRoute, liveStateRoute]),
      ]),
    ]),
  ]);

  const history = createMemoryHistory({ initialEntries: [initialEntry] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({ routeTree, history, context: { queryClient } });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("_previewable layout", () => {
  it("shows the preview banner on a route that does not opt out", async () => {
    renderPreviewableLayout("/as-code?preview=pr-1");

    expect(await screen.findByText("as-code page")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Exit preview" }),
    ).toBeInTheDocument();
  });

  it("hides the preview banner on a route with hidePreviewFrame: true", async () => {
    renderPreviewableLayout("/live-state?preview=pr-1");

    expect(await screen.findByText("live-state page")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Exit preview" }),
    ).not.toBeInTheDocument();
  });
});
