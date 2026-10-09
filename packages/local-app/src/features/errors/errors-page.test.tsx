import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ErrorDetailPage,
  ErrorIssueSearchSchema,
  ErrorsPage,
} from "./errors-page";

vi.mock("../local-telemetry/collector-status", () => ({
  LocalTelemetryGate: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/features/logs/local-sql-client", () => ({
  localSqlClient: {},
}));

vi.mock("@everr/ui/components/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => (
    <section role="dialog">{children}</section>
  ),
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));

vi.mock("@everr/telemetry-explorer/errors", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@everr/telemetry-explorer/errors")>();

  return {
    ...actual,
    ErrorsRepository: class ErrorsRepository {},
    ErrorIssues: () => <div>Error list page</div>,
    ErrorDetail: ({ onClose }: { onClose: () => void }) => (
      <div>
        Error detail page
        <button type="button" onClick={onClose}>
          Close detail
        </button>
      </div>
    ),
  };
});

vi.mock("@everr/telemetry-explorer/traces", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@everr/telemetry-explorer/traces")>();

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
      getParentRoute: () => errorsRoute,
      path: "$fingerprint",
      validateSearch: ErrorIssueSearchSchema,
      component: ErrorDetailPage,
    });
    const routeTree = rootRoute.addChildren([
      shellRoute.addChildren([errorsRoute.addChildren([errorDetailRoute])]),
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

  it("renders direct error detail routes through the dialog route", async () => {
    const router = renderErrorsRoute([
      "/errors/fp-1?q=timeout&occurrence=old-occurrence",
    ]);

    expect(await screen.findByText("Error list page")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Error detail page")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close detail" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Error list page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/errors");
    expect(router.state.location.search).toMatchObject({
      q: "timeout",
      occurrence: "",
    });
  });
});
