import type * as TracesTypes from "@everr/telemetry-explorer/traces";
import type { TraceExplorerProps } from "@everr/telemetry-explorer/traces";
import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { fakeExploreBackend } from "../../testing/backend";
import type { ShellRouterContext } from "../backend";
import { TraceDetailRoute } from "./traces";

vi.mock("@everr/telemetry-explorer/traces", async (importOriginal) => ({
  ...(await importOriginal<typeof TracesTypes>()),
  TraceExplorer: ({ search, onSpanChange }: TraceExplorerProps) => {
    const viewport = useRef<HTMLDivElement>(null);
    return (
      <div>
        <div data-testid="waterfall" ref={viewport}>
          Selected {search.span ?? "none"}
        </div>
        <button
          type="button"
          onClick={() => {
            onSpanChange("child");
            requestAnimationFrame(() => {
              if (viewport.current) {
                viewport.current.scrollTop = 700;
                fireEvent.scroll(viewport.current);
              }
            });
          }}
        >
          Select flamegraph span
        </button>
      </div>
    );
  },
}));

afterEach(() => vi.restoreAllMocks());

// Its own route tree, not the contract router: the test holds a navigation
// open with a `beforeLoad` it controls.
it("preserves the viewer's span scroll when a delayed URL update finishes", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  let navigationBlocked = false;
  let finishNavigation = () => {};
  const navigationReady = new Promise<void>((resolve) => {
    finishNavigation = resolve;
  });
  const root = createRootRouteWithContext<ShellRouterContext>()();
  const trace = createRoute({
    getParentRoute: () => root,
    path: "/traces/$traceId",
    validateSearch: (search: Record<string, unknown>) => ({
      span: search.span as string | undefined,
    }),
    beforeLoad: () => (navigationBlocked ? navigationReady : undefined),
    component: TraceDetailRoute,
  });
  const router = createRouter({
    routeTree: root.addChildren([trace]),
    history: createMemoryHistory({ initialEntries: ["/traces/trace-1"] }),
    context: { queryClient: new QueryClient(), explore: fakeExploreBackend() },
    scrollRestoration: true,
  });
  render(<RouterProvider router={router} />);
  const viewport = await screen.findByTestId("waterfall");
  viewport.scrollTop = 120;
  fireEvent.scroll(viewport);
  navigationBlocked = true;
  fireEvent.click(screen.getByRole("button", { name: "Select flamegraph span" }));
  await waitFor(() => expect(viewport.scrollTop).toBe(700));
  await act(async () => finishNavigation());
  await screen.findByText("Selected child");
  expect(viewport.scrollTop).toBe(700);
  expect(router.state.location.search.span).toBe("child");
});
