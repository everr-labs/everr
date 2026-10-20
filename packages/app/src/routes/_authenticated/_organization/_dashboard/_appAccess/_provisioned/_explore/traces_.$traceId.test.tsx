import type { TraceExplorerProps } from "@everr/telemetry-explorer/traces";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Route } from "./traces_.$traceId";

vi.mock("@/data/traces/remote-repo", () => ({
  remoteTracesRepo: {
    getTrace: vi.fn(async () => []),
    search: vi.fn(async () => []),
    listServiceIdentities: vi.fn(async () => []),
    attributeKeys: vi.fn(async () => []),
    attributeValues: vi.fn(async () => []),
  },
}));
vi.mock("@everr/telemetry-explorer/traces", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@everr/telemetry-explorer/traces")
  >()),
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

it("preserves the viewer's span scroll when a delayed URL update finishes", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(Route, "useParams").mockReturnValue({ traceId: "trace-1" });
  vi.spyOn(Route, "useSearch").mockImplementation(() =>
    useSearch({ strict: false }),
  );
  vi.spyOn(Route, "useNavigate").mockImplementation(() => useNavigate());
  let navigationBlocked = false;
  let finishNavigation = () => {};
  const navigationReady = new Promise<void>((resolve) => {
    finishNavigation = resolve;
  });
  const root = createRootRoute();
  const trace = createRoute({
    getParentRoute: () => root,
    path: "/traces/$traceId",
    validateSearch: (search: Record<string, unknown>) => ({
      span: search.span as string | undefined,
    }),
    beforeLoad: () => (navigationBlocked ? navigationReady : undefined),
    component: Route.options.component,
  });
  const router = createRouter({
    routeTree: root.addChildren([trace]),
    history: createMemoryHistory({ initialEntries: ["/traces/trace-1"] }),
    scrollRestoration: true,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const viewport = await screen.findByTestId("waterfall");
  viewport.scrollTop = 120;
  fireEvent.scroll(viewport);
  navigationBlocked = true;
  fireEvent.click(
    screen.getByRole("button", { name: "Select flamegraph span" }),
  );
  await waitFor(() => expect(viewport.scrollTop).toBe(700));
  await act(async () => finishNavigation());
  await screen.findByText("Selected child");
  expect(viewport.scrollTop).toBe(700);
  expect(router.state.location.search.span).toBe("child");
});
