import type * as TelemetryErrors from "@everr/telemetry-explorer/errors";
import type * as TelemetryTraces from "@everr/telemetry-explorer/traces";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { ErrorDetailPage, ErrorIssueSearchSchema, ErrorsPage } from "./errors-page";

vi.mock("../local-telemetry/collector-status", () => ({
  LocalTelemetryGate: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/features/logs/local-sql-client", () => ({
  localSqlClient: {},
}));

vi.mock("@everr/telemetry-explorer/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof TelemetryErrors>();

  return {
    ...actual,
    ErrorsRepository: class ErrorsRepository {},
    ErrorIssues: () => <div>Error list page</div>,
    ErrorDetail: ({ onBack }: { onBack: () => void }) => (
      <div>
        Error detail page
        <button type="button" onClick={onBack}>
          Back to errors
        </button>
      </div>
    ),
  };
});

vi.mock("@everr/telemetry-explorer/traces", async (importOriginal) => {
  const actual = await importOriginal<typeof TelemetryTraces>();

  return {
    ...actual,
    TracesRepository: class TracesRepository {},
  };
});

describe("local errors routes", () => {
  function renderErrorsRoute(initialEntries: string[]) {
    const rootRoute = createRootRoute({ component: Outlet });
    const shellRoute = createRoute({
      getParentRoute: () => rootRoute,
      id: "_shell",
      component: Outlet,
    });
    const errorsRoute = createRoute({
      getParentRoute: () => shellRoute,
      path: "/errors",
      validateSearch: ErrorIssueSearchSchema,
      component: ErrorsPage,
    });
    const errorDetailRoute = createRoute({
      getParentRoute: () => shellRoute,
      path: "/errors/$fingerprint",
      validateSearch: ErrorIssueSearchSchema,
      component: ErrorDetailPage,
    });
    const routeTree = rootRoute.addChildren([
      shellRoute.addChildren([errorsRoute, errorDetailRoute]),
    ]);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries }),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return router;
  }

  it("renders error detail as its own page and goes back to the filtered list", async () => {
    const router = renderErrorsRoute(["/errors/fp-1?q=timeout&occurrence=old-occurrence"]);

    expect(await screen.findByText("Error detail page")).toBeInTheDocument();
    expect(screen.queryByText("Error list page")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to errors" }));
    expect(await screen.findByText("Error list page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/errors");
    expect(router.state.location.search).toMatchObject({
      q: "timeout",
      occurrence: "",
    });
  });
});
