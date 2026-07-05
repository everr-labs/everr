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
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { ErrorDetailPage, ErrorIssueSearchSchema, ErrorsPage } from "./errors-page";

vi.mock("../local-telemetry/collector-status", () => ({
  LocalTelemetryGate: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/features/logs/local-sql-client", () => ({
  localSqlClient: {},
}));

vi.mock("@everr/ui/components/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <section role="dialog">{children}</section>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));

vi.mock("@everr/telemetry-explorer/errors", async (importOriginal) => {
  const actual = await importOriginal<typeof TelemetryErrors>();

  return {
    ...actual,
    ErrorsRepository: class ErrorsRepository {},
    ErrorIssues: () => <div>Error list page</div>,
    ErrorDetail: () => <div>Error detail page</div>,
  };
});

vi.mock("@everr/telemetry-explorer/traces", async (importOriginal) => {
  const actual = await importOriginal<typeof TelemetryTraces>();

  return {
    ...actual,
    TracesRepository: class TracesRepository {},
  };
});

describe("desktop errors routes", () => {
  function renderErrorsRoute(initialEntries: string[]) {
    const rootRoute = createRootRoute({ component: Outlet });
    const shellRoute = createRoute({
      getParentRoute: () => rootRoute,
      id: "shell",
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
  }

  it("renders direct error detail routes through the dialog route", async () => {
    renderErrorsRoute(["/errors/fp-1"]);

    expect(await screen.findByText("Error list page")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Error detail page")).toBeInTheDocument();
  });
});
