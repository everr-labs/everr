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
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CcSilence } from "@/data/cc/types";
import { Route as SilencesFileRoute } from "./silences";

// ---------------------------------------------------------------------------
// Mocks, at the same module boundary as ../rules.test.tsx.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  listCcSilences: vi.fn(),
  createCcSilence: vi.fn(),
  deleteCcSilence: vi.fn(),
}));

vi.mock("@/data/cc/server", () => ({
  listCcSilences: mocks.listCcSilences,
  createCcSilence: mocks.createCcSilence,
  deleteCcSilence: mocks.deleteCcSilence,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function ccSilence(overrides: Partial<CcSilence> = {}): CcSilence {
  return {
    id: "sil-1",
    tenant: "org1",
    matchers: [{ label: "host", op: "eq", value: "web-1" }],
    starts_at: "2026-06-14T00:00:00Z",
    ends_at: "2026-06-14T01:00:00Z",
    comment: "maintenance",
    author: null,
    created_at: "2026-06-13T23:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function renderSilencesRoute() {
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
  const silencesRoute = createRoute({
    getParentRoute: () => dashboardRoute,
    path: "cc-alerting/monitor/silences",
    component: SilencesFileRoute.options.component,
  });

  const routeTree = rootRoute.addChildren([
    authenticatedRoute.addChildren([
      dashboardRoute.addChildren([silencesRoute]),
    ]),
  ]);

  const history = createMemoryHistory({
    initialEntries: ["/cc-alerting/monitor/silences"],
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    history,
    context: { queryClient },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

describe("/cc-alerting/monitor/silences route", () => {
  beforeEach(() => {
    mocks.listCcSilences.mockReset();
    mocks.createCcSilence.mockReset();
    mocks.deleteCcSilence.mockReset();
  });

  it("shows author and creation time as muted row metadata", async () => {
    mocks.listCcSilences.mockResolvedValue([ccSilence({ author: "alice" })]);

    renderSilencesRoute();

    expect(await screen.findByText("maintenance")).toBeInTheDocument();
    const meta = screen.getByText(/by alice · created /);
    expect(meta).toBeInTheDocument();
    // Formatted like the row's other timestamps (ccFormatTs → toLocaleString).
    expect(meta.textContent).toContain(
      new Date("2026-06-13T23:00:00Z").toLocaleString(),
    );
  });

  it("omits the author fragment when the silence has none", async () => {
    mocks.listCcSilences.mockResolvedValue([ccSilence()]);

    renderSilencesRoute();

    expect(await screen.findByText("maintenance")).toBeInTheDocument();
    expect(screen.queryByText(/by /)).not.toBeInTheDocument();
    expect(screen.getByText(/created /)).toBeInTheDocument();
  });
});
